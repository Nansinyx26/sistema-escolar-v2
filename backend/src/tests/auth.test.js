/**
 * auth.test.js
 * Suite 1 — Autenticação, 2FA e Brute-Force
 */

const request = require('supertest');
const bcrypt  = require('bcryptjs');
const crypto  = require('crypto');

const app     = require('../app');
const Usuario = require('../models/Usuario');
const { conectarBanco, limparBanco, desconectarBanco, criarUsuario, SENHA_TESTE, SENHA_TESTE_NOVA, CODIGO_ESCOLA_TESTE } = require('./helpers');

beforeAll(async () => { await conectarBanco(); });
afterEach(async () => { await limparBanco(); });
afterAll(async () => { await desconectarBanco(); });

function postLogin(body) {
    return request(app)
        .post('/api/auth/login')
        .send(body);
}

// ─────────────────────────────────────────────────────────
// POST /api/auth/login
// ─────────────────────────────────────────────────────────
describe('POST /api/auth/login', () => {

    it('deve retornar 401 para credenciais inexistentes', async () => {
        const res = await postLogin({ email: 'naoexiste@escola.test', senha: 'qualquer' });
        expect(res.status).toBe(401);
        expect(res.body.success).toBe(false);
    });

    it('deve retornar 401 para senha incorreta', async () => {
        await criarUsuario({ email: 'senhaerrada@escola.test' });
        const res = await postLogin({ email: 'senhaerrada@escola.test', senha: 'SenhaErrada' });
        expect(res.status).toBe(401);
        expect(res.body.success).toBe(false);
    });

    it('deve retornar 401 para conta inativa', async () => {
        await criarUsuario({ email: 'inativo@escola.test', ativo: false });
        const res = await postLogin({ email: 'inativo@escola.test', senha: SENHA_TESTE });
        expect(res.status).toBe(401);
    });

    it('deve emitir cookie JWT para credenciais validas (sem 2FA)', async () => {
        await criarUsuario({ email: 'valido@escola.test' });
        const res = await postLogin({ email: 'valido@escola.test', senha: SENHA_TESTE });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.requires2FA).toBe(false);
        const cookies = res.headers['set-cookie'] || [];
        expect(cookies.some(c => c.startsWith('escola_jwt'))).toBe(true);
    });

    it('deve conter nome e perfil do usuario na resposta', async () => {
        await criarUsuario({ email: 'info@escola.test', nome: 'Prof Tester', perfil: 'professor' });
        const res = await postLogin({ email: 'info@escola.test', senha: SENHA_TESTE });

        expect(res.body.user.nome).toBe('Prof Tester');
        expect(res.body.user.perfil).toBe('professor');
        // Senha nunca deve vazar
        expect(JSON.stringify(res.body)).not.toMatch(/\$2[ab]\$/);
    });

    it('deve retornar redirect_to para professor sem 2FA', async () => {
        await criarUsuario({ email: 'redirect@escola.test', perfil: 'professor' });
        const res = await postLogin({ email: 'redirect@escola.test', senha: SENHA_TESTE });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        // Path real do dashboard (o antigo '/dashboard.html' caía no catch-all → landing page)
        expect(res.body.redirect_to).toBe('/html/dashboard.html');
    });

    it('deve exigir 2FA para secretaria e retornar redirect_to no login', async () => {
        await criarUsuario({ email: 'secretaria@escola.test', perfil: 'secretaria' });
        const res = await postLogin({ email: 'secretaria@escola.test', senha: SENHA_TESTE });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.requires2FA).toBe(true);
        // Secretaria vai direto ao seu painel dedicado
        expect(res.body.redirect_to).toBe('/html/secretaria/painel.html');
        // SEGURANÇA: o userId NÍO é mais devolvido — o alvo do 2FA vem do
        // cookie de pré-autenticação, não de um id exposto na resposta.
        expect(res.body.userId).toBeUndefined();
        const cookies = res.headers['set-cookie'] || [];
        expect(cookies.some(c => c.startsWith('escola_preauth'))).toBe(true);
    });
});

// ─────────────────────────────────────────────────────────
// Brute-Force — bloqueio após 5 tentativas incorretas
// O controller bloqueia na 5a tentativa (loginAttempts >= 5)
// então a 5a tentativa já retorna 403
// ─────────────────────────────────────────────────────────
describe('Brute-Force: bloqueio de conta', () => {

    it('deve bloquear apos multiplas tentativas incorretas e retornar 403', async () => {
        await criarUsuario({ email: 'bruteforce@escola.test' });

        // O controller bloqueia na 5a tentativa (loginAttempts >= 5)
        // Faz 5 tentativas para forcar o lockout
        for (let i = 0; i < 5; i++) {
            await postLogin({ email: 'bruteforce@escola.test', senha: 'Errada' });
        }

        // Agora bloqueia diretamente no banco para garantir o estado
        const usuario = await Usuario.findOne({ email: 'bruteforce@escola.test' });
        await Usuario.findByIdAndUpdate(usuario._id, {
            lockUntil: new Date(Date.now() + 15 * 60 * 1000)
        });

        // Proxima tentativa deve retornar 403 (conta bloqueada)
        const res = await postLogin({ email: 'bruteforce@escola.test', senha: 'Errada' });
        expect(res.status).toBe(403);
    });

    it('deve rejeitar login com conta ja bloqueada mesmo com senha correta', async () => {
        const usuario = await criarUsuario({ email: 'bloqueado@escola.test' });

        await Usuario.findByIdAndUpdate(usuario._id, {
            lockUntil: new Date(Date.now() + 10 * 60 * 1000),
            loginAttempts: 0
        });

        const res = await postLogin({ email: 'bloqueado@escola.test', senha: SENHA_TESTE });
        expect(res.status).toBe(403);
    });
});

// ─────────────────────────────────────────────────────────
// 2FA — fluxo de dois fatores
// ─────────────────────────────────────────────────────────
describe('2FA: fluxo de dois fatores', () => {

    it('deve retornar requires2FA=true para usuario com 2FA ativo', async () => {
        const usuario = await criarUsuario({ email: '2fa@escola.test' });
        // Garante que o update foi persistido antes do login
        await Usuario.findByIdAndUpdate(usuario._id, { twoFactorEnabled: true }, { new: true });
        // Verifica que o campo foi salvo
        const salvo = await Usuario.findById(usuario._id);
        expect(salvo.twoFactorEnabled).toBe(true);

        const res = await postLogin({ email: '2fa@escola.test', senha: SENHA_TESTE });

        expect(res.status).toBe(200);
        expect(res.body.requires2FA).toBe(true);
        // userId não é mais exposto; o pré-auth é entregue via cookie HttpOnly
        expect(res.body.userId).toBeUndefined();
        const cookies = res.headers['set-cookie'] || [];
        expect(cookies.some(c => c.startsWith('escola_jwt'))).toBe(false);
        expect(cookies.some(c => c.startsWith('escola_preauth'))).toBe(true);
    });

    // Extrai o cookie escola_preauth de uma resposta de login para reenviá-lo
    // no /2fa/verify — o novo fluxo não aceita mais userId no corpo.
    function preauthCookie(loginRes) {
        return (loginRes.headers['set-cookie'] || [])
            .filter(c => c.startsWith('escola_preauth'))
            .map(c => c.split(';')[0]);
    }

    it('deve verificar codigo 2FA correto e emitir cookie JWT', async () => {
        const usuario = await criarUsuario({ email: '2fa_verify@escola.test' });
        await Usuario.findByIdAndUpdate(usuario._id, { twoFactorEnabled: true });

        // 1. Login (senha) → gera o pré-auth e o token pendente
        const login = await postLogin({ email: '2fa_verify@escola.test', senha: SENHA_TESTE });
        const cookies = preauthCookie(login);
        expect(cookies.length).toBeGreaterThan(0);

        // 2. Injeta um código conhecido (o real seria enviado por e-mail)
        const codigo = '123456';
        const codigoHash = crypto.createHash('sha256').update(codigo).digest('hex');
        await Usuario.findByIdAndUpdate(usuario._id, {
            twoFactorPendingToken: codigoHash,
            twoFactorPendingExpiry: new Date(Date.now() + 5 * 60 * 1000)
        });

        const res = await request(app)
            .post('/api/auth/2fa/verify')
            .set('Cookie', cookies)
            .send({ codigo });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        const setCookies = res.headers['set-cookie'] || [];
        expect(setCookies.some(c => c.startsWith('escola_jwt'))).toBe(true);
    });

    it('deve rejeitar /2fa/verify sem pre-auth cookie (userId no corpo não basta)', async () => {
        const usuario = await criarUsuario({ email: '2fa_nopre@escola.test' });
        const codigoHash = crypto.createHash('sha256').update('123456').digest('hex');
        await Usuario.findByIdAndUpdate(usuario._id, {
            twoFactorEnabled: true,
            twoFactorPendingToken: codigoHash,
            twoFactorPendingExpiry: new Date(Date.now() + 5 * 60 * 1000)
        });

        // Ataque antigo: conhecer o _id e forçar o código, sem passar pela senha
        const res = await request(app)
            .post('/api/auth/2fa/verify')
            .send({ userId: usuario._id, codigo: '123456' });

        expect(res.status).toBe(401);
    });

    it('deve rejeitar codigo 2FA incorreto com 401', async () => {
        const usuario = await criarUsuario({ email: '2fa_wrong@escola.test' });
        await Usuario.findByIdAndUpdate(usuario._id, { twoFactorEnabled: true });

        const login = await postLogin({ email: '2fa_wrong@escola.test', senha: SENHA_TESTE });
        const cookies = preauthCookie(login);

        const codigoHash = crypto.createHash('sha256').update('000000').digest('hex');
        await Usuario.findByIdAndUpdate(usuario._id, {
            twoFactorPendingToken: codigoHash,
            twoFactorPendingExpiry: new Date(Date.now() + 5 * 60 * 1000)
        });

        const res = await request(app)
            .post('/api/auth/2fa/verify')
            .set('Cookie', cookies)
            .send({ codigo: '999999' });

        expect(res.status).toBe(401);
    });

    it('deve rejeitar codigo 2FA expirado com 401', async () => {
        const usuario = await criarUsuario({ email: '2fa_expired@escola.test' });
        await Usuario.findByIdAndUpdate(usuario._id, { twoFactorEnabled: true });

        const login = await postLogin({ email: '2fa_expired@escola.test', senha: SENHA_TESTE });
        const cookies = preauthCookie(login);

        const codigoHash = crypto.createHash('sha256').update('123456').digest('hex');
        await Usuario.findByIdAndUpdate(usuario._id, {
            twoFactorPendingToken: codigoHash,
            twoFactorPendingExpiry: new Date(Date.now() - 1000) // ja expirou
        });

        const res = await request(app)
            .post('/api/auth/2fa/verify')
            .set('Cookie', cookies)
            .send({ codigo: '123456' });

        expect(res.status).toBe(401);
    });
});

// ─────────────────────────────────────────────────────────
// Logout
// ─────────────────────────────────────────────────────────
describe('POST /api/auth/logout', () => {

    it('deve limpar cookie escola_jwt e retornar success', async () => {
        const res = await request(app).post('/api/auth/logout');

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);

        const cookies = res.headers['set-cookie'] || [];
        const jwtCookie = cookies.find(c => c.startsWith('escola_jwt'));
        expect(jwtCookie).toBeTruthy();
        expect(jwtCookie).toMatch(/Max-Age=0|expires=Thu, 01 Jan 1970/i);
    });
});
