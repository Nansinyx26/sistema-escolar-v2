/**
 * edgeGuard.test.js — proteção de borda (Issue #332)
 *
 * Duas formas de exercitar o módulo:
 *   - pelo app REAL, para os filtros determinísticos (método, caminho,
 *     user-agent), que ficam ligados em teste justamente para isto;
 *   - por um app descartável com registro próprio, para o que acumula estado
 *     (pontuação, banimento, teto de taxa), que no app real fica desligado em
 *     teste para as suítes não se banirem umas às outras.
 */
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const request = require('supertest');
const app = require('../app');
const logger = require('../utils/logger');
const edgeGuard = require('../middleware/edgeGuard');

const { classificarCaminho, classificarUserAgent, criarRegistro, hashDoIp, ARMADILHAS, PONTOS } =
    edgeGuard;

const RAIZ_FRONTEND = path.join(__dirname, '../../../');
const UM_MINUTO = 60 * 1000;

/** App mínimo com a borda completa e um registro isolado. */
function appDeBorda({ registro, rajada, sustentado } = {}) {
    const mini = express();
    mini.set('trust proxy', 1);
    mini.use(edgeGuard.criarGuardaDeBanimento({ registro, ativo: true }));
    mini.use(edgeGuard.criarGuardaDeFiltros({ registro, pontuar: true }));
    mini.use(...edgeGuard.criarLimitesDeBorda({ registro, ativo: true, rajada, sustentado }));
    mini.all('*', (_req, res) => res.status(200).send('ok'));
    return mini;
}

/** Relógio controlável para o registro. */
function relogio(inicio = 1_000_000) {
    let t = inicio;
    return {
        agora: () => t,
        avancar: (ms) => {
            t += ms;
        },
    };
}

describe('edgeGuard — filtros de caminho', () => {
    it('bloqueia sondagem de outro stack com 404 opaco', async () => {
        const sondas = [
            '/wp-login.php',
            '/wp-admin/setup-config.php',
            '/.env',
            '/.git/config',
            '/vendor/phpunit/phpunit/src/Util/PHP/eval-stdin.php',
            '/phpmyadmin/',
            '/backup.sql',
            '/server-status',
        ];
        for (const sonda of sondas) {
            const res = await request(app).get(sonda);
            expect(`${sonda} -> ${res.status}`).toBe(`${sonda} -> 404`);
            expect(res.text).toBe('Nao encontrado.');
        }
    });

    it('responde a sondagem SEM ler o 404.html do disco', async () => {
        const sonda = await request(app).get('/wp-login.php');
        const comum = await request(app).get('/pagina-que-nao-existe-de-verdade');

        // O 404 comum é a página amigável, lida do disco; o da sondagem é texto
        // puro montado em memória. Mesmo status, custo muito diferente.
        expect(sonda.status).toBe(404);
        expect(comum.status).toBe(404);
        expect(sonda.headers['content-type']).toMatch(/text\/plain/);
        expect(comum.headers['content-type']).toMatch(/text\/html/);
    });

    it('NAO bloqueia os caminhos legitimos do frontend', async () => {
        for (const caminho of ['/', '/index.html', '/manifest.json']) {
            const res = await request(app).get(caminho);
            expect(`${caminho} -> ${res.status}`).toBe(`${caminho} -> 200`);
        }

        // Página restrita: o 302 é o gate de páginas mandando o anônimo para o
        // login. Chegar ao gate é a prova de que a borda deixou passar — a
        // borda nunca responde 302.
        const restrita = await request(app).get('/html/dashboard.html');
        expect(restrita.status).toBe(302);
    });

    it('nenhum arquivo servido pelo site casa com filtro de sondagem', () => {
        // Varredura de TODOS os arquivos dos diretórios estáticos. Um arquivo
        // novo que caia numa regra (um `.sh` de exemplo, um `config.ini`)
        // quebra aqui, e não no site em produção.
        const diretorios = [
            'css',
            'js',
            'img',
            'html',
            'detalhes',
            'direcao',
            'graficos',
            'favicon',
            'portal-responsavel/dist',
        ];
        const barrados = [];
        let conferidos = 0;

        const varrer = (absoluto, publico) => {
            if (!fs.existsSync(absoluto)) return;
            for (const item of fs.readdirSync(absoluto, { withFileTypes: true })) {
                if (item.name === 'node_modules') continue;
                const abs = path.join(absoluto, item.name);
                const pub = `${publico}/${item.name}`;
                if (item.isDirectory()) {
                    varrer(abs, pub);
                } else {
                    conferidos += 1;
                    const url = encodeURI(pub);
                    const veredicto = classificarCaminho(url, url);
                    if (veredicto) barrados.push(`${pub} (${veredicto.motivo})`);
                }
            }
        };
        for (const dir of diretorios) varrer(path.join(RAIZ_FRONTEND, dir), `/${dir}`);

        expect(conferidos).toBeGreaterThan(100);
        expect(barrados).toEqual([]);
    });

    it('bloqueia travessia de diretorio, inclusive percent-encoded', () => {
        expect(classificarCaminho('/../etc/passwd')).toMatchObject({ motivo: 'travessia' });
        expect(classificarCaminho('/%2e%2e%2fetc%2fpasswd')).toMatchObject({ motivo: 'travessia' });
        expect(classificarCaminho('/html/..%5c..%5cwin.ini')).toMatchObject({
            motivo: 'travessia',
        });
    });

    it('bloqueia log4shell e SQLi na query string', () => {
        // Payload do Log4Shell percent-encoded, que é como ele chega de verdade.
        // Escrito literal, o `${` dispararia o lint de template em string comum.
        expect(
            classificarCaminho('/api/alunos', '/api/alunos?q=%24%7Bjndi:ldap://x/a%7D')
        ).toMatchObject({ motivo: 'injecao' });
        expect(
            classificarCaminho('/api/alunos', '/api/alunos?id=1%20UNION%20SELECT%20senha')
        ).toMatchObject({
            motivo: 'injecao',
        });
    });

    it('barra repetida nao serve de disfarce para a sondagem', () => {
        expect(classificarCaminho('//.env')).toMatchObject({ motivo: 'dotfile' });
        expect(classificarCaminho('///wp-login.php')).not.toBeNull();
    });

    it('trata percent-encoding invalido como sinal, nao como erro', () => {
        expect(() => classificarCaminho('/%zz')).not.toThrow();
        expect(classificarCaminho('/%zz')).toMatchObject({ motivo: 'url-malformada' });
    });

    it('percent-encoding invalido recebe 400, nao o 404 opaco', async () => {
        // 400 é o status correto para URL que não decodifica, e era o que o
        // gate de páginas já respondia (gateAnonimo.test.js).
        const res = await request(app).get('/html/%ZZ/perfil.html');
        expect(res.status).toBe(400);
        expect(res.headers['content-type']).toMatch(/text\/plain/);
    });

    it('isenta .well-known (ACME, security.txt) da regra de dotfile', () => {
        expect(classificarCaminho('/.well-known/security.txt')).toBeNull();
        expect(classificarCaminho('/.well-known/acme-challenge/abc123')).toBeNull();
    });
});

describe('edgeGuard — armadilhas', () => {
    it('toda isca anunciada no robots.txt e de fato uma armadilha', async () => {
        const res = await request(app).get('/robots.txt');
        expect(res.status).toBe(200);

        for (const isca of ARMADILHAS) {
            expect(res.text).toContain(`Disallow: ${isca}/`);
            expect(classificarCaminho(isca)).toMatchObject({
                motivo: 'armadilha',
                armadilha: true,
            });
        }
    });

    it('a isca casa com e sem barra final, e sem depender de caixa', () => {
        expect(classificarCaminho('/painel-interno/')).toMatchObject({ armadilha: true });
        expect(classificarCaminho('/Painel-Interno')).toMatchObject({ armadilha: true });
    });

    it('robots.txt bloqueia as areas autenticadas da indexacao', async () => {
        const res = await request(app).get('/robots.txt');
        for (const area of ['/html/', '/api/', '/direcao/', '/portal-responsavel/']) {
            expect(res.text).toContain(`Disallow: ${area}`);
        }
    });

    it('cair numa armadilha bane o IP na hora', async () => {
        const registro = criarRegistro();
        const mini = appDeBorda({ registro });

        await request(mini).get('/painel-interno');
        const depois = await request(mini).get('/');

        expect(registro.resumo().banidos).toBe(1);
        expect(depois.status).toBe(429);
    });
});

describe('edgeGuard — metodos HTTP', () => {
    it('rejeita TRACE (vetor de Cross-Site Tracing) com 405', async () => {
        const res = await request(app).trace('/');
        expect(res.status).toBe(405);
        expect(res.headers.allow).toContain('GET');
        expect(res.headers.allow).not.toContain('TRACE');
    });

    it('aceita os verbos que a aplicacao usa, inclusive PATCH', async () => {
        const chamadas = [
            request(app).get('/'),
            request(app).head('/'),
            request(app).post('/api/rota-inexistente'),
            request(app).put('/api/rota-inexistente'),
            request(app).patch('/api/chat-direto/lida/abc'),
            request(app).delete('/api/rota-inexistente'),
            request(app).options('/api/rota-inexistente'),
        ];
        for (const res of await Promise.all(chamadas)) {
            expect(`${res.req.method} -> ${res.status}`).not.toBe(`${res.req.method} -> 405`);
        }
    });
});

describe('edgeGuard — user-agent', () => {
    it('bloqueia ferramenta de ataque que se identifica', async () => {
        const res = await request(app)
            .get('/')
            .set('User-Agent', 'sqlmap/1.7.2#stable (https://sqlmap.org)');
        expect(res.status).toBe(403);
    });

    it('bloqueia scraper comercial de SEO', () => {
        expect(
            classificarUserAgent(
                'Mozilla/5.0 (compatible; AhrefsBot/7.0; +http://ahrefs.com/robot/)'
            )
        ).toMatchObject({ motivo: 'ua-scraper' });
        expect(classificarUserAgent('Mozilla/5.0 (compatible; SemrushBot/7~bl)')).toMatchObject({
            motivo: 'ua-scraper',
        });
    });

    it('DEIXA PASSAR preview de link — a escola manda o portal por WhatsApp', () => {
        expect(classificarUserAgent('WhatsApp/2.23.20.0 A')).toBeNull();
        expect(classificarUserAgent('TelegramBot (like TwitterBot)')).toBeNull();
        expect(classificarUserAgent('facebookexternalhit/1.1')).toBeNull();
    });

    it('DEIXA PASSAR buscador legitimo e monitor de uptime', () => {
        expect(classificarUserAgent('Mozilla/5.0 (compatible; Googlebot/2.1)')).toBeNull();
        expect(classificarUserAgent('Mozilla/5.0+(compatible; UptimeRobot/2.0)')).toBeNull();
    });

    it('NAO bloqueia ausencia de user-agent', async () => {
        const res = await request(app).get('/').set('User-Agent', '');
        expect(res.status).toBe(200);
    });

    it('NAO bloqueia navegador comum', () => {
        expect(
            classificarUserAgent(
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
            )
        ).toBeNull();
    });
});

describe('edgeGuard — registro de abuso', () => {
    it('nao bane num bloqueio isolado', () => {
        const registro = criarRegistro();
        const r = registro.registrar('1.1.1.1', PONTOS.sondagem);
        expect(r.banido).toBe(false);
    });

    it('bane ao cruzar o limiar', () => {
        const registro = criarRegistro({ limiar: 25 });
        registro.registrar('1.1.1.1', PONTOS.sondagem);
        registro.registrar('1.1.1.1', PONTOS.sondagem);
        const r = registro.registrar('1.1.1.1', PONTOS.sondagem);
        expect(r).toMatchObject({ banido: true, novoBanimento: true });
    });

    it('o banimento expira sozinho', () => {
        const t = relogio();
        const registro = criarRegistro({ banBaseMs: UM_MINUTO, agora: t.agora });
        registro.banirAgora('1.1.1.1');
        expect(registro.situacao('1.1.1.1').banido).toBe(true);

        t.avancar(UM_MINUTO + 1);
        expect(registro.situacao('1.1.1.1').banido).toBe(false);
    });

    it('a pena DOBRA a cada reincidencia, ate um teto', () => {
        const t = relogio();
        const registro = criarRegistro({
            banBaseMs: UM_MINUTO,
            banMaxMs: 3 * UM_MINUTO,
            agora: t.agora,
        });
        const duracoes = [];
        for (let i = 0; i < 4; i += 1) {
            duracoes.push(registro.banirAgora('1.1.1.1').restanteMs);
            t.avancar(duracoes[i] + 1);
        }
        expect(duracoes).toEqual([UM_MINUTO, 2 * UM_MINUTO, 3 * UM_MINUTO, 3 * UM_MINUTO]);
    });

    it('os pontos expiram sem banimento quando o IP se comporta', () => {
        const t = relogio();
        const registro = criarRegistro({ janelaMs: UM_MINUTO, limiar: 25, agora: t.agora });
        registro.registrar('1.1.1.1', 20);
        t.avancar(UM_MINUTO + 1);
        const r = registro.registrar('1.1.1.1', 20);
        expect(r.banido).toBe(false);
        expect(r.pontos).toBe(20);
    });

    it('a memoria NAO cresce sem limite sob ataque distribuido', () => {
        const registro = criarRegistro({ maxEntradas: 100 });
        for (let i = 0; i < 5000; i += 1) registro.registrar(`10.${i >> 8}.${i & 255}.1`, 1);
        expect(registro.resumo().rastreados).toBeLessThanOrEqual(100);
    });

    it('o despejo preserva os BANIDOS — sao eles que economizam trabalho', () => {
        const registro = criarRegistro({ maxEntradas: 10 });
        registro.banirAgora('6.6.6.6');
        for (let i = 0; i < 50; i += 1) registro.registrar(`10.0.0.${i}`, 1);
        expect(registro.situacao('6.6.6.6').banido).toBe(true);
    });

    it('o contador de um IP nao contamina outro', () => {
        const registro = criarRegistro();
        registro.banirAgora('1.1.1.1');
        expect(registro.situacao('2.2.2.2').banido).toBe(false);
    });
});

describe('edgeGuard — estouro de taxa pontua por JANELA, nao por requisicao', () => {
    it('varias requisicoes excedentes na mesma janela valem uma pontuacao so', () => {
        const registro = criarRegistro({ limiar: 25 });
        let ultimo;
        for (let i = 0; i < 50; i += 1)
            ultimo = registro.registrarEstouroDeTaxa('1.1.1.1', 'taxa-rajada', 'j1');
        expect(ultimo.banido).toBe(false);
        expect(registro.registrar('1.1.1.1', 0).pontos).toBe(PONTOS.taxa);
    });

    it('janelas estouradas em sequencia acabam banindo (flood sustentado)', () => {
        const registro = criarRegistro({ limiar: 25 });
        const janelasParaBanir = Math.ceil(25 / PONTOS.taxa);
        let banidoNa = null;
        for (let j = 1; j <= 20 && banidoNa === null; j += 1) {
            if (registro.registrarEstouroDeTaxa('1.1.1.1', 'taxa-rajada', `j${j}`).banido)
                banidoNa = j;
        }
        expect(banidoNa).toBe(janelasParaBanir);
    });

    it('rajada e sustentada sao limitadores diferentes e pontuam cada um uma vez', () => {
        const registro = criarRegistro();
        registro.registrarEstouroDeTaxa('1.1.1.1', 'taxa-rajada', 'j1');
        registro.registrarEstouroDeTaxa('1.1.1.1', 'taxa-sustentada', 'j1');
        registro.registrarEstouroDeTaxa('1.1.1.1', 'taxa-rajada', 'j1');
        expect(registro.registrar('1.1.1.1', 0).pontos).toBe(2 * PONTOS.taxa);
    });
});

describe('edgeGuard — teto de taxa em todo o site', () => {
    // Os tetos de PRODUÇÃO, passados explicitamente: em teste o padrão é 10x.
    const PRODUCAO = {
        rajada: { windowMs: 10 * 1000, max: 240 },
        sustentado: { windowMs: 5 * UM_MINUTO, max: 1500 },
    };

    it('QUATRO pessoas atras do mesmo NAT abrindo o painel NAO banem a escola', async () => {
        // html/dashboard.html referencia ~73 subrecursos: cada visita são ~74
        // requisições. Antes da pontuação por janela, a 247ª requisição banía
        // o IP público da escola inteira (Issue #332).
        const registro = criarRegistro();
        const mini = appDeBorda({ registro, ...PRODUCAO });
        const agente = request(mini);

        let recusadas = 0;
        for (let pessoa = 0; pessoa < 4; pessoa += 1) {
            for (let i = 0; i < 74; i += 1) {
                const res = await agente.get(`/css/recurso-${i}.css`);
                if (res.status === 429) recusadas += 1;
            }
        }

        expect(recusadas).toBeGreaterThan(0); // o teto de rajada foi de fato atingido
        expect(registro.resumo().banidos).toBe(0);
        expect(registro.registrar('127.0.0.1', 0).pontos).toBeLessThanOrEqual(2 * PONTOS.taxa);
    });

    it('vale fora de /api: pagina e estatico recebem 429 com Retry-After', async () => {
        const registro = criarRegistro();
        const mini = appDeBorda({ registro, rajada: { windowMs: 60 * 1000, max: 2 } });
        const agente = request(mini);

        await agente.get('/index.html');
        await agente.get('/css/estilo.css');
        const pagina = await agente.get('/html/dashboard.html');
        const api = await agente.get('/api/alunos');

        expect(pagina.status).toBe(429);
        expect(pagina.headers['retry-after']).toMatch(/^\d+$/);
        expect(pagina.headers['content-type']).toMatch(/text\/plain/);
        expect(api.status).toBe(429);
        expect(api.body).toMatchObject({ success: false });
    });

    it('health check e robots.txt nunca recebem 429, nem com o teto estourado', async () => {
        const registro = criarRegistro();
        const mini = appDeBorda({ registro, rajada: { windowMs: 60 * 1000, max: 1 } });
        const agente = request(mini);

        await agente.get('/');
        await agente.get('/');
        for (const caminho of ['/api/health', '/health', '/ready', '/robots.txt']) {
            const res = await agente.get(caminho);
            expect(`${caminho} -> ${res.status}`).toBe(`${caminho} -> 200`);
        }
    });
});

describe('edgeGuard — guarda de banimento', () => {
    it('responde 429 com Retry-After e sem tocar na cadeia seguinte', async () => {
        const registro = criarRegistro();
        registro.banirAgora('127.0.0.1');

        let alcancou = false;
        const mini = express();
        mini.use(edgeGuard.criarGuardaDeBanimento({ registro, ativo: true }));
        mini.use((_req, res) => {
            alcancou = true;
            res.send('ok');
        });

        const res = await request(mini).get('/');
        expect(res.status).toBe(429);
        expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
        expect(alcancou).toBe(false);
    });

    it('o health check do Render nunca e barrado, mesmo com o IP banido', async () => {
        const registro = criarRegistro();
        registro.banirAgora('127.0.0.1');
        const mini = appDeBorda({ registro });

        for (const caminho of ['/api/health', '/health', '/ready', '/robots.txt']) {
            const res = await request(mini).get(caminho);
            expect(`${caminho} -> ${res.status}`).toBe(`${caminho} -> 200`);
        }
    });
});

describe('edgeGuard — privacidade do log', () => {
    afterEach(() => jest.restoreAllMocks());

    it('o IP nunca aparece em claro no identificador logado', () => {
        const hash = hashDoIp('203.0.113.9');
        expect(hash).toMatch(/^[0-9a-f]{12}$/);
        expect(hash).not.toContain('203');
    });

    it('o mesmo IP gera o mesmo hash dentro da execucao (correlacionavel)', () => {
        expect(hashDoIp('203.0.113.9')).toBe(hashDoIp('203.0.113.9'));
        expect(hashDoIp('203.0.113.9')).not.toBe(hashDoIp('203.0.113.10'));
    });

    it('nenhuma linha de log de bloqueio ou banimento carrega o IP', async () => {
        const linhas = [];
        const capturar = (...args) => linhas.push(JSON.stringify(args));
        jest.spyOn(logger, 'warn').mockImplementation(capturar);
        jest.spyOn(logger, 'alert').mockImplementation(capturar);

        const registro = criarRegistro();
        const mini = appDeBorda({ registro });
        const ip = '203.0.113.77';
        await request(mini).get('/.env').set('X-Forwarded-For', ip);
        await request(mini).get('/painel-interno').set('X-Forwarded-For', ip);

        expect(linhas.length).toBeGreaterThan(0);
        for (const linha of linhas) expect(linha).not.toContain(ip);
    });
});
