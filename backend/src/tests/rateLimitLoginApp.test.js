/**
 * rateLimitLoginApp.test.js — a proteção de login montada no app real, com o
 * controller de verdade, e as rotas administrativas de bloqueio (Issue #333).
 */
const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../app');
const {
    conectarBanco,
    limparBanco,
    desconectarBanco,
    criarUsuario,
    SENHA_TESTE,
} = require('./helpers');

beforeAll(async () => {
    await conectarBanco();
    // Em teste a proteção fica desligada para as outras suítes poderem errar
    // senha à vontade; esta suíte liga explicitamente.
    process.env.RATE_LIMIT_EM_TESTE = 'true';
});
afterEach(async () => {
    await limparBanco();
});
afterAll(async () => {
    delete process.env.RATE_LIMIT_EM_TESTE;
    await desconectarBanco();
});

let contador = 0;
const loginDe = (ip, corpo) =>
    request(app).post('/api/auth/login').set('X-Forwarded-For', ip).send(corpo);

const cookieDe = (usuario) =>
    `escola_jwt=${jwt.sign(
        {
            id: String(usuario._id),
            perfil: usuario.perfil,
            email: usuario.email,
            purpose: 'session',
        },
        process.env.JWT_SECRET,
        { expiresIn: '1h' }
    )}`;

async function bloquearIp(ip) {
    // Contas diferentes a cada tentativa: é o padrão de quem varre contas, e
    // não esbarra no bloqueio por conta do próprio controller.
    for (let i = 0; i < 5; i++) {
        const res = await loginDe(ip, { email: `varredura${++contador}@escola.test`, senha: 'x' });
        expect(res.status).toBe(401);
    }
    return loginDe(ip, { email: `varredura${++contador}@escola.test`, senha: 'x' });
}

describe('login real atrás da proteção por IP', () => {
    it('5 falhas do mesmo IP bloqueiam a 6ª com 429 e Retry-After', async () => {
        const res = await bloquearIp('203.0.113.200');
        expect(res.status).toBe(429);
        expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
        expect(res.body).toMatchObject({ codigo: 'MUITAS_TENTATIVAS' });
        expect(res.body.retryEmSegundos).toBeGreaterThan(0);
    });

    it('o bloqueio de um IP não atinge quem entra de outro', async () => {
        await bloquearIp('203.0.113.201');
        const usuario = await criarUsuario();
        const res = await loginDe('203.0.113.202', { email: usuario.email, senha: SENHA_TESTE });
        expect(res.status).toBe(200);
    });
});

describe('rotas administrativas', () => {
    it('diag-ip mostra o IP que o servidor enxergou', async () => {
        const admin = await criarUsuario({ perfil: 'admin' });
        const res = await request(app)
            .get('/api/admin/seguranca/diag-ip')
            .set('X-Forwarded-For', '198.51.100.44')
            .set('Cookie', cookieDe(admin));
        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({ ok: true, ipResolvido: '198.51.100.44' });
    });

    it('lista e remove o bloqueio; o IP volta a entrar', async () => {
        await bloquearIp('203.0.113.210');
        const admin = await criarUsuario({ perfil: 'admin' });

        const lista = await request(app)
            .get('/api/admin/seguranca/bloqueios-ip')
            .set('Cookie', cookieDe(admin));
        expect(lista.status).toBe(200);
        const bloqueio = lista.body.bloqueios.find((b) => b.chave === '203.0.113.210');
        expect(bloqueio).toMatchObject({ escopo: 'login', nivel: 1 });
        expect(bloqueio.restanteSegundos).toBeGreaterThan(0);

        const remocao = await request(app)
            .delete(`/api/admin/seguranca/bloqueios-ip/${encodeURIComponent(bloqueio.id)}`)
            .set('Cookie', cookieDe(admin));
        expect(remocao.status).toBe(200);

        const usuario = await criarUsuario();
        const res = await loginDe('203.0.113.210', { email: usuario.email, senha: SENHA_TESTE });
        expect(res.status).toBe(200);
    });

    it('remover bloqueio inexistente responde 404', async () => {
        const admin = await criarUsuario({ perfil: 'admin' });
        const res = await request(app)
            .delete('/api/admin/seguranca/bloqueios-ip/login%3A192.0.2.1')
            .set('Cookie', cookieDe(admin));
        expect(res.status).toBe(404);
    });

    it('quem não é admin não vê nem remove bloqueio', async () => {
        const professor = await criarUsuario({ perfil: 'professor' });
        const res = await request(app)
            .get('/api/admin/seguranca/bloqueios-ip')
            .set('Cookie', cookieDe(professor));
        expect(res.status).toBe(403);
    });
});
