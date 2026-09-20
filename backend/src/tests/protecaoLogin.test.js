/**
 * protecaoLogin.test.js — força bruta por IP no login e bloqueio progressivo
 * (Issue #333).
 *
 * O login aqui é um handler falso (senha "certa" → 200, qualquer outra → 401),
 * para o teste medir só a proteção. O relógio é controlado pelo teste: dá para
 * atravessar bloqueios de horas sem esperar.
 */
const express = require('express');
const request = require('supertest');
const { criarProtecaoLogin } = require('../middleware/protecaoLogin');
const { configuracaoLogin } = require('../config/rateLimit');
const { criarListaIps } = require('../utils/ipCliente');
const BloqueioIpService = require('../services/protecaoAbuso/BloqueioIpService');
const BloqueioIp = require('../models/BloqueioIp');
const AuditLog = require('../models/AuditLog');
const { conectarBanco, limparBanco, desconectarBanco } = require('./helpers');

const MIN = 60 * 1000;

beforeAll(async () => {
    await conectarBanco();
});
afterEach(async () => {
    await limparBanco();
});
afterAll(async () => {
    await desconectarBanco();
});

/**
 * Monta o cenário: app com a proteção, relógio manual e contagem de quantas
 * tentativas chegaram de fato ao login.
 */
function cenario(sobrescrever = {}) {
    // A data começa no FUTURO de propósito, e isso não é detalhe de estilo.
    // `BloqueioIp` tem índice TTL em `expiraEm` (`expireAfterSeconds: 0`), e o
    // Mongo decide o que expirou pelo relógio REAL — não por este relógio. Com
    // uma data fixa no passado, o `expiraEm` gravado já nascia vencido: a
    // varredura de TTL (a cada 60 s) apagava o bloqueio no meio de um teste que
    // faz 30 tentativas, e a seguinte voltava 401 em vez de 429. Passava na
    // máquina rápida e reprovava o CI de vez em quando (Issue #416, vista no
    // run 35479197456). Quando o teste nasceu, em #333, `2026-09-14` era o dia
    // corrente e o campo caía no futuro; a armadilha só apareceu com o tempo.
    let agora = new Date('2099-09-14T10:00:00Z');
    const pendentes = [];
    const estado = { chegaramAoLogin: 0 };
    const config = {
        maxFalhas: 5,
        janelaMs: 15 * MIN,
        bloqueioBaseMs: 15 * MIN,
        bloqueioMaxMs: 60 * MIN,
        memoriaMs: 24 * 60 * MIN,
        ipsLivres: criarListaIps(''),
        ...sobrescrever,
    };

    const app = express();
    app.set('trust proxy', 1);
    app.use(express.json());
    app.post(
        '/api/auth/login',
        criarProtecaoLogin({
            configuracao: () => config,
            relogio: () => agora,
            pular: () => false,
            aoConcluir: (p) => pendentes.push(p),
        }),
        (req, res) => {
            estado.chegaramAoLogin++;
            if (req.body.senha === 'certa') return res.json({ success: true });
            return res.status(401).json({ success: false, codigo: 'CREDENCIAL_INVALIDA' });
        }
    );

    // Espera a escrita feita depois da resposta (devolver tentativa ou aplicar
    // bloqueio) antes da próxima requisição.
    async function esperarPendentes() {
        await new Promise((r) => setImmediate(r));
        await Promise.all(pendentes.splice(0));
    }

    async function login(senha, ip = '203.0.113.10') {
        const res = await request(app)
            .post('/api/auth/login')
            .set('X-Forwarded-For', ip)
            .send({ email: 'alguem@escola.test', senha });
        await esperarPendentes();
        return res;
    }

    return {
        app,
        config,
        estado,
        login,
        esperarPendentes,
        avancar(ms) {
            agora = new Date(agora.getTime() + ms);
        },
        agora: () => agora,
    };
}

async function errar(c, vezes, ip) {
    const respostas = [];
    for (let i = 0; i < vezes; i++) respostas.push(await c.login('errada', ip));
    return respostas;
}

describe('POST /api/auth/login — proteção por IP', () => {
    it('5 falhas passam; a 6ª tentativa recebe 429 com Retry-After', async () => {
        const c = cenario();
        const falhas = await errar(c, 5);
        expect(falhas.map((r) => r.status)).toEqual([401, 401, 401, 401, 401]);

        const bloqueada = await c.login('errada');
        expect(bloqueada.status).toBe(429);
        expect(bloqueada.headers['retry-after']).toBe(String(15 * 60));
        expect(bloqueada.body).toMatchObject({
            success: false,
            codigo: 'MUITAS_TENTATIVAS',
            retryEmSegundos: 15 * 60,
        });
        expect(c.estado.chegaramAoLogin).toBe(5);
    });

    it('bloqueado, nem a senha certa entra até o prazo acabar', async () => {
        const c = cenario();
        await errar(c, 5);
        expect((await c.login('certa')).status).toBe(429);
        expect(c.estado.chegaramAoLogin).toBe(5);
    });

    it('login certo não consome tentativa', async () => {
        const c = cenario();
        for (let i = 0; i < 10; i++) expect((await c.login('certa')).status).toBe(200);
        const falhas = await errar(c, 4);
        expect(falhas.every((r) => r.status === 401)).toBe(true);
        // Ainda cabe mais uma falha antes do bloqueio.
        expect((await c.login('errada')).status).toBe(401);
        expect((await c.login('errada')).status).toBe(429);
    });

    it('rajada paralela não passa do teto antes de o contador atualizar', async () => {
        const c = cenario();
        const respostas = await Promise.all(
            Array.from({ length: 20 }, () =>
                request(c.app)
                    .post('/api/auth/login')
                    .set('X-Forwarded-For', '203.0.113.77')
                    .send({ senha: 'errada' })
            )
        );
        await c.esperarPendentes();
        expect(c.estado.chegaramAoLogin).toBeLessThanOrEqual(5);
        expect(respostas.filter((r) => r.status === 429).length).toBeGreaterThanOrEqual(15);
    });

    it('cada IP tem o seu contador', async () => {
        const c = cenario();
        await errar(c, 5, '203.0.113.1');
        expect((await c.login('errada', '203.0.113.1')).status).toBe(429);
        expect((await c.login('errada', '203.0.113.2')).status).toBe(401);
    });

    it('falhas espalhadas fora da janela não somam', async () => {
        const c = cenario();
        await errar(c, 4);
        c.avancar(16 * MIN);
        const depois = await errar(c, 4);
        expect(depois.every((r) => r.status === 401)).toBe(true);
    });

    it('tentativa feita durante o bloqueio não conta para depois do prazo', async () => {
        const c = cenario();
        await errar(c, 5);
        const duranteOBloqueio = await errar(c, 30);
        expect(duranteOBloqueio.every((r) => r.status === 429)).toBe(true);

        c.avancar(15 * MIN + 1000);
        // Depois do prazo o IP tem as 5 tentativas de novo, não um bloqueio imediato.
        const depois = await errar(c, 5);
        expect(depois.map((r) => r.status)).toEqual([401, 401, 401, 401, 401]);
    });

    it('o bloqueio gravado não nasce vencido para o TTL real do Mongo', async () => {
        // Guarda da armadilha descrita em `cenario()`: se o relógio do teste
        // voltar para o passado, `expiraEm` nasce vencido, o TTL do Mongo apaga
        // o bloqueio no meio da suíte e a falha aparece longe daqui, de forma
        // intermitente. Esta asserção faz esse erro aparecer na hora.
        const c = cenario();
        await errar(c, 5);
        expect((await c.login('errada')).status).toBe(429);

        const registro = await BloqueioIp.findOne({}).lean();
        expect(registro.expiraEm.getTime()).toBeGreaterThan(Date.now());
        expect(registro.bloqueadoAte.getTime()).toBeGreaterThan(Date.now());
    });

    it('o bloqueio expira sozinho no prazo', async () => {
        const c = cenario();
        await errar(c, 5);
        c.avancar(15 * MIN - 1000);
        expect((await c.login('certa')).status).toBe(429);
        c.avancar(2000);
        expect((await c.login('certa')).status).toBe(200);
    });

    it('reincidência dobra o bloqueio: 15 → 30 → 60 min, e para no teto', async () => {
        const c = cenario(); // teto de 60 min neste cenário
        const duracoes = [];
        for (let rodada = 0; rodada < 4; rodada++) {
            await errar(c, 5);
            const bloqueada = await c.login('errada');
            duracoes.push(bloqueada.body.retryEmSegundos / 60);
            c.avancar(bloqueada.body.retryEmSegundos * 1000 + 1000);
        }
        expect(duracoes).toEqual([15, 30, 60, 60]);
    });

    it('sem bloqueio por mais que a memória, a reincidência recomeça', async () => {
        const c = cenario({ memoriaMs: 60 * MIN });
        await errar(c, 5);
        expect((await c.login('errada')).body.retryEmSegundos).toBe(15 * 60);
        c.avancar(15 * MIN + 61 * MIN);
        await errar(c, 5);
        expect((await c.login('errada')).body.retryEmSegundos).toBe(15 * 60);
    });

    it('nenhum bloqueio é permanente: todo registro tem prazo de expiração', async () => {
        const c = cenario();
        await errar(c, 5);
        const doc = await BloqueioIp.collection.findOne({ escopo: 'login' });
        expect(doc.bloqueadoAte).toBeInstanceOf(Date);
        expect(doc.bloqueadoAte.getTime() - c.agora().getTime()).toBe(15 * MIN);
        // O registro (e o IP) somem sozinhos: bloqueio + memória de reincidência.
        expect(doc.expiraEm.getTime()).toBe(doc.bloqueadoAte.getTime() + c.config.memoriaMs);
        const indices = await BloqueioIp.collection.indexes();
        expect(indices.some((i) => i.key.expiraEm === 1 && i.expireAfterSeconds === 0)).toBe(true);
    });

    it('o bloqueio fica registrado na auditoria', async () => {
        const c = cenario();
        await errar(c, 5);
        const registro = await AuditLog.findOne({ acao: 'LOGIN_IP_BLOQUEADO' }).lean();
        expect(registro).not.toBeNull();
        expect(registro.detalhes.descricao).toMatch(/15 min/);
    });

    it('IP da lista livre nunca é bloqueado por IP', async () => {
        const c = cenario({ ipsLivres: criarListaIps('203.0.113.0/24') });
        const respostas = await errar(c, 12, '203.0.113.99');
        expect(respostas.every((r) => r.status === 401)).toBe(true);
    });

    it('o administrador remove o bloqueio e a reincidência junto', async () => {
        const c = cenario();
        await errar(c, 5);
        const [ativo] = await BloqueioIpService.listarAtivos(c.agora());
        expect(ativo).toMatchObject({ escopo: 'login', chave: '203.0.113.10', nivel: 1 });

        expect(await BloqueioIpService.remover(ativo.id)).toBe(true);
        expect((await c.login('certa')).status).toBe(200);
        expect(await BloqueioIpService.listarAtivos(c.agora())).toHaveLength(0);
    });

    it('banco indisponível não derruba o login', async () => {
        const c = cenario();
        const espiao = jest
            .spyOn(BloqueioIpService, 'registrarTentativa')
            .mockRejectedValue(new Error('Atlas indisponível'));
        try {
            expect((await c.login('certa')).status).toBe(200);
        } finally {
            espiao.mockRestore();
        }
    });
});

describe('configuracaoLogin', () => {
    it('sem variável nenhuma: 5 falhas em 15 min, bloqueio de 15 min até 24 h', () => {
        const cfg = configuracaoLogin({});
        expect(cfg).toMatchObject({
            maxFalhas: 5,
            janelaMs: 15 * MIN,
            bloqueioBaseMs: 15 * MIN,
            bloqueioMaxMs: 24 * 60 * MIN,
            memoriaMs: 24 * 60 * MIN,
        });
        expect(cfg.ipsLivres.total).toBe(0);
    });

    it('lê o ambiente e recusa valor inválido sem afrouxar', () => {
        const cfg = configuracaoLogin({
            RATE_LIMIT_LOGIN_FALHAS: '3',
            RATE_LIMIT_LOGIN_JANELA: '10m',
            RATE_LIMIT_LOGIN_BLOQUEIO: '15', // sem unidade: recusado
            RATE_LIMIT_LOGIN_BLOQUEIO_MAX: '2h',
            RATE_LIMIT_IPS_LIVRES: '203.0.113.25',
        });
        expect(cfg.maxFalhas).toBe(3);
        expect(cfg.janelaMs).toBe(10 * MIN);
        expect(cfg.bloqueioBaseMs).toBe(15 * MIN);
        expect(cfg.bloqueioMaxMs).toBe(120 * MIN);
        expect(cfg.ipsLivres.contem('203.0.113.25')).toBe(true);
    });

    it('teto menor que o bloqueio base vira o próprio bloqueio base', () => {
        const cfg = configuracaoLogin({
            RATE_LIMIT_LOGIN_BLOQUEIO: '2h',
            RATE_LIMIT_LOGIN_BLOQUEIO_MAX: '30m',
        });
        expect(cfg.bloqueioMaxMs).toBe(cfg.bloqueioBaseMs);
    });
});
