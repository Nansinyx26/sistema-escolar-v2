/**
 * rateLimitGlobal.test.js — teto geral de /api e regras por endpoint (Issue #333).
 *
 * O limitador global é montado exatamente como no app.js — `app.use('/api', …)`
 * depois do cookieParser —, porque foi a montagem que o desligava: dentro de
 * um middleware montado em `/api`, `req.path` chega sem o prefixo.
 */
const express = require('express');
const request = require('supertest');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const JWT_SECRET = require('../utils/jwtConfig');
const { criarLimiteGlobal, criarLimitesPorRota } = require('../middleware/rateLimiters');
const { regrasPorRota, configuracaoGlobal, lerDuracao } = require('../config/rateLimit');

const nunca = () => false;
let sequencia = 0;

function appGlobal({ maxIp = 3, maxUsuario = 5 } = {}) {
    const app = express();
    app.set('trust proxy', 1);
    app.use(cookieParser());
    app.use(
        '/api',
        criarLimiteGlobal({
            config: { janelaMs: 60 * 1000, maxIp, maxUsuario },
            pular: nunca,
            // Store próprio por app: o MemoryStore não se reaproveita.
            nome: `teste-global-${++sequencia}`,
        })
    );
    app.get('/api/alunos', (_req, res) => res.json({ ok: true }));
    app.get('/api/health', (_req, res) => res.json({ ok: true }));
    return app;
}

const tokenDe = (id, segredo = JWT_SECRET, extra = {}) =>
    jwt.sign({ id, perfil: 'professor', purpose: 'session', ...extra }, segredo, {
        expiresIn: '1h',
    });

async function repetir(vezes, fazer) {
    const respostas = [];
    for (let i = 0; i < vezes; i++) respostas.push(await fazer(i));
    return respostas;
}

describe('limite global de /api', () => {
    it('regressão: montado em /api, o teto por IP é aplicado de fato', async () => {
        const app = appGlobal();
        const ok = await repetir(3, () =>
            request(app).get('/api/alunos').set('X-Forwarded-For', '203.0.113.1')
        );
        expect(ok.map((r) => r.status)).toEqual([200, 200, 200]);

        const excesso = await request(app).get('/api/alunos').set('X-Forwarded-For', '203.0.113.1');
        expect(excesso.status).toBe(429);
        expect(Number(excesso.headers['retry-after'])).toBeGreaterThan(0);
        expect(excesso.headers['ratelimit-limit']).toBe('3');
        expect(excesso.body).toMatchObject({ success: false, codigo: 'MUITAS_TENTATIVAS' });
        expect(excesso.body.retryEmSegundos).toBeGreaterThan(0);
    });

    it('cada IP anônimo tem o seu teto', async () => {
        const app = appGlobal();
        await repetir(4, () =>
            request(app).get('/api/alunos').set('X-Forwarded-For', '203.0.113.1')
        );
        const outro = await request(app).get('/api/alunos').set('X-Forwarded-For', '203.0.113.2');
        expect(outro.status).toBe(200);
    });

    it('usuário autenticado conta pela conta, não pelo IP da escola', async () => {
        const app = appGlobal();
        const ipDaEscola = '203.0.113.50';
        // Três professores atrás do mesmo IP: cada um tem 5, não os três dividem 3.
        for (const id of ['prof-a', 'prof-b', 'prof-c']) {
            const respostas = await repetir(5, () =>
                request(app)
                    .get('/api/alunos')
                    .set('X-Forwarded-For', ipDaEscola)
                    .set('Cookie', `escola_jwt=${tokenDe(id)}`)
            );
            expect(respostas.every((r) => r.status === 200)).toBe(true);
        }
        const sexta = await request(app)
            .get('/api/alunos')
            .set('X-Forwarded-For', ipDaEscola)
            .set('Cookie', `escola_jwt=${tokenDe('prof-a')}`);
        expect(sexta.status).toBe(429);
        expect(sexta.headers['ratelimit-limit']).toBe('5');
    });

    it('também reconhece o token no cabeçalho Authorization', async () => {
        const app = appGlobal({ maxIp: 1 });
        const respostas = await repetir(3, () =>
            request(app)
                .get('/api/alunos')
                .set('X-Forwarded-For', '203.0.113.60')
                .set('Authorization', `Bearer ${tokenDe('prof-bearer')}`)
        );
        expect(respostas.every((r) => r.status === 200)).toBe(true);
    });

    it('token com assinatura inválida não ganha contador próprio: cai no teto por IP', async () => {
        const app = appGlobal();
        const respostas = await repetir(4, (i) =>
            request(app)
                .get('/api/alunos')
                .set('X-Forwarded-For', '203.0.113.70')
                .set('Cookie', `escola_jwt=${tokenDe(`forjado-${i}`, 'segredo-errado')}`)
        );
        expect(respostas.map((r) => r.status)).toEqual([200, 200, 200, 429]);
    });

    it('token intermediário do 2FA não conta como sessão', async () => {
        const app = appGlobal({ maxIp: 1, maxUsuario: 10 });
        const token = tokenDe('pre-auth', JWT_SECRET, { purpose: 'pre-auth' });
        const respostas = await repetir(2, () =>
            request(app)
                .get('/api/alunos')
                .set('X-Forwarded-For', '203.0.113.80')
                .set('Cookie', `escola_jwt=${token}`)
        );
        expect(respostas.map((r) => r.status)).toEqual([200, 429]);
    });

    it('aba com sessão vencida conta pela conta e não gasta o teto anônimo da escola', async () => {
        const app = appGlobal({ maxIp: 2, maxUsuario: 10 });
        const ipDaEscola = '203.0.113.85';
        const vencido = jwt.sign(
            {
                id: 'prof-aba-esquecida',
                purpose: 'session',
                exp: Math.floor(Date.now() / 1000) - 60,
            },
            JWT_SECRET
        );
        const daAbaEsquecida = await repetir(5, () =>
            request(app)
                .get('/api/alunos')
                .set('X-Forwarded-For', ipDaEscola)
                .set('Cookie', `escola_jwt=${vencido}`)
        );
        expect(daAbaEsquecida.every((r) => r.status === 200)).toBe(true);
        // Quem abre a tela de login no mesmo IP ainda tem o orçamento inteiro.
        const anonimas = await repetir(2, () =>
            request(app).get('/api/alunos').set('X-Forwarded-For', ipDaEscola)
        );
        expect(anonimas.map((r) => r.status)).toEqual([200, 200]);
    });

    it('health check fica fora do teto', async () => {
        const app = appGlobal({ maxIp: 1 });
        const respostas = await repetir(5, () =>
            request(app).get('/api/health').set('X-Forwarded-For', '203.0.113.90')
        );
        expect(respostas.every((r) => r.status === 200)).toBe(true);
    });
});

describe('regras por endpoint', () => {
    function appComRegras(regras) {
        const app = express();
        app.set('trust proxy', 1);
        app.use(cookieParser());
        app.use(criarLimitesPorRota(regras, { pular: nunca }));
        app.all('/api/*', (_req, res) => res.json({ ok: true }));
        return app;
    }

    const regra = (extra) => ({
        nome: `POST /api/relatorios #${++sequencia}`,
        metodo: 'POST',
        caminho: '/api/relatorios',
        limite: 2,
        janelaMs: 60 * 1000,
        chave: 'ip',
        ...extra,
    });

    it('aplica teto próprio ao método e caminho da regra, incluindo subcaminhos', async () => {
        const app = appComRegras([regra()]);
        const ip = '198.51.100.1';
        expect((await request(app).post('/api/relatorios').set('X-Forwarded-For', ip)).status).toBe(
            200
        );
        expect(
            (await request(app).post('/api/relatorios/x').set('X-Forwarded-For', ip)).status
        ).toBe(200);
        const excesso = await request(app).post('/api/relatorios').set('X-Forwarded-For', ip);
        expect(excesso.status).toBe(429);
        expect(excesso.headers['retry-after']).toBeDefined();
    });

    it('não toca em outro método nem em caminho parecido', async () => {
        const app = appComRegras([regra({ limite: 1 })]);
        const ip = '198.51.100.2';
        await request(app).post('/api/relatorios').set('X-Forwarded-For', ip);
        expect((await request(app).get('/api/relatorios').set('X-Forwarded-For', ip)).status).toBe(
            200
        );
        expect(
            (await request(app).post('/api/relatorios-antigos').set('X-Forwarded-For', ip)).status
        ).toBe(200);
    });

    it('regra por usuário ignora o anônimo e conta cada conta à parte', async () => {
        const app = appComRegras([regra({ chave: 'usuario', limite: 1 })]);
        const ip = '198.51.100.3';
        const anonimas = await repetir(3, () =>
            request(app).post('/api/relatorios').set('X-Forwarded-For', ip)
        );
        expect(anonimas.every((r) => r.status === 200)).toBe(true);

        const comoA = () =>
            request(app)
                .post('/api/relatorios')
                .set('X-Forwarded-For', ip)
                .set('Cookie', `escola_jwt=${tokenDe('usuario-a')}`);
        expect((await comoA()).status).toBe(200);
        expect((await comoA()).status).toBe(429);
        const comoB = await request(app)
            .post('/api/relatorios')
            .set('X-Forwarded-For', ip)
            .set('Cookie', `escola_jwt=${tokenDe('usuario-b')}`);
        expect(comoB.status).toBe(200);
    });
});

describe('leitura das variáveis de ambiente', () => {
    it('RATE_LIMIT_ROTAS válido vira regra com janela e chave', () => {
        const regras = regrasPorRota({
            RATE_LIMIT_ROTAS: JSON.stringify([
                { rota: 'post /api/relatorios/', limite: 10, janela: '2m', chave: 'usuario' },
                { rota: '/api/exportar', limite: 3 },
            ]),
        });
        expect(regras).toEqual([
            {
                nome: 'POST /api/relatorios/',
                metodo: 'POST',
                caminho: '/api/relatorios',
                limite: 10,
                janelaMs: 2 * 60 * 1000,
                chave: 'usuario',
            },
            {
                nome: '* /api/exportar',
                metodo: '*',
                caminho: '/api/exportar',
                limite: 3,
                janelaMs: 60 * 1000,
                chave: 'usuario-ou-ip',
            },
        ]);
    });

    it('entrada inválida é descartada sem derrubar as válidas', () => {
        const regras = regrasPorRota({
            RATE_LIMIT_ROTAS: JSON.stringify([
                { rota: 'POST /fora-da-api', limite: 1 },
                { rota: 'VOAR /api/x', limite: 1 },
                { rota: 'GET /api/x', limite: 0 },
                { rota: 'GET /api/x', limite: 1, chave: 'cpf' },
                { limite: 1 },
                { rota: 'GET /api/ok', limite: 1 },
            ]),
        });
        expect(regras.map((r) => r.nome)).toEqual(['GET /api/ok']);
    });

    it('JSON quebrado ou que não é lista não aplica regra nenhuma', () => {
        expect(regrasPorRota({ RATE_LIMIT_ROTAS: '[{' })).toEqual([]);
        expect(regrasPorRota({ RATE_LIMIT_ROTAS: '{"rota":"GET /api/x"}' })).toEqual([]);
        expect(regrasPorRota({})).toEqual([]);
    });

    it('teto global: 100 por IP e 200 por conta por minuto em produção', () => {
        expect(configuracaoGlobal({ NODE_ENV: 'production' })).toEqual({
            janelaMs: 60 * 1000,
            maxIp: 100,
            maxUsuario: 200,
        });
        expect(
            configuracaoGlobal({
                NODE_ENV: 'production',
                RATE_LIMIT_GLOBAL_IP: '50',
                RATE_LIMIT_GLOBAL_USUARIO: 'muito',
                RATE_LIMIT_GLOBAL_JANELA: '30s',
            })
        ).toEqual({ janelaMs: 30 * 1000, maxIp: 50, maxUsuario: 200 });
    });

    it.each([
        ['30s', 30 * 1000],
        ['15m', 15 * 60 * 1000],
        ['1h', 60 * 60 * 1000],
        ['2d', 2 * 24 * 60 * 60 * 1000],
        ['15', 999],
        ['0m', 999],
        ['-5m', 999],
        ['', 999],
    ])('lerDuracao("%s")', (texto, esperado) => {
        expect(lerDuracao(texto, 999, 'TESTE')).toBe(esperado);
    });
});
