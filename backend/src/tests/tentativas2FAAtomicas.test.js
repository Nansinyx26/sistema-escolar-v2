/**
 * tentativas2FAAtomicas.test.js — Issue #669
 *
 * O limite de 5 tentativas do 2FA era contornável: o reenvio e o login zeravam
 * o contador, e o contador era lido e regravado em dois passos (palpites em
 * paralelo eram todos comparados). Agora a tentativa é reservada de forma
 * atômica antes da comparação, e o contador só zera com acerto ou no bloqueio.
 */
const request = require('supertest');
const crypto = require('node:crypto');
const app = require('../app');
const Usuario = require('../models/Usuario');
const EnvioEmail = require('../services/EnvioEmail');
const {
    conectarBanco,
    limparBanco,
    desconectarBanco,
    criarUsuario,
    SENHA_TESTE,
} = require('./helpers');

let espiaoEmail;
beforeAll(async () => {
    await conectarBanco();
});
beforeEach(() => {
    // Nenhum e-mail sai de verdade: o envio do código responde como entregue.
    espiaoEmail = jest.spyOn(EnvioEmail, 'enviarEmail').mockResolvedValue({ ok: true });
});
afterEach(async () => {
    espiaoEmail.mockRestore();
    await limparBanco();
});
afterAll(async () => {
    await desconectarBanco();
});

const CODIGO = '424242';
const hash = (c) => crypto.createHash('sha256').update(c).digest('hex');

function preauthCookie(res) {
    return (res.headers['set-cookie'] || [])
        .filter((c) => c.startsWith('escola_preauth='))
        .map((c) => c.split(';')[0]);
}

async function diretorNoSegundoFator(email) {
    const diretor = await criarUsuario({ email, perfil: 'diretor' });
    const login = await request(app).post('/api/auth/login').send({ email, senha: SENHA_TESTE });
    expect(login.body.requires2FA).toBe(true);
    // Código conhecido, para o acerto.
    await Usuario.updateOne(
        { _id: diretor._id },
        {
            twoFactorPendingToken: hash(CODIGO),
            twoFactorPendingExpiry: new Date(Date.now() + 300000),
        }
    );
    return { diretor, cookie: preauthCookie(login) };
}

const verificar = (cookie, codigo) =>
    request(app).post('/api/auth/2fa/verify').set('Cookie', cookie).send({ codigo });

const estado = (id) => Usuario.findById(id).select('+twoFactorAttempts +twoFactorLockUntil').lean();

it('errar 4, pedir código novo e errar mais 1 bloqueia', async () => {
    const { diretor, cookie } = await diretorNoSegundoFator('dir1.669@escola.test');

    for (let i = 0; i < 4; i++) expect((await verificar(cookie, '000001')).status).toBe(401);
    const envio = await request(app).post('/api/auth/2fa/send').set('Cookie', cookie);
    expect(envio.status).toBe(200);
    expect((await estado(diretor._id)).twoFactorAttempts).toBe(4);

    const quinta = await verificar(cookie, '000001');

    expect(quinta.status).toBe(429);
    expect((await estado(diretor._id)).twoFactorLockUntil).toBeTruthy();
});

it('durante o bloqueio, o reenvio responde 429 e o código certo não entra', async () => {
    const { diretor, cookie } = await diretorNoSegundoFator('dir2.669@escola.test');
    await Usuario.updateOne(
        { _id: diretor._id },
        { twoFactorLockUntil: new Date(Date.now() + 600000) }
    );

    expect((await request(app).post('/api/auth/2fa/send').set('Cookie', cookie)).status).toBe(429);
    expect((await verificar(cookie, CODIGO)).status).toBe(429);
});

it('20 palpites em paralelo: no máximo 5 são comparados, e o resto é 429', async () => {
    const { diretor, cookie } = await diretorNoSegundoFator('dir3.669@escola.test');

    const respostas = await Promise.all(
        Array.from({ length: 20 }, (_, i) => verificar(cookie, String(100000 + i)))
    );

    const comparados = respostas.filter((r) => r.status === 401).length;
    expect(comparados).toBeLessThanOrEqual(5);
    expect(respostas.every((r) => [401, 429].includes(r.status))).toBe(true);
    expect((await estado(diretor._id)).twoFactorLockUntil).toBeTruthy();
});

it('um novo login não zera o contador', async () => {
    const email = 'dir4.669@escola.test';
    const { diretor, cookie } = await diretorNoSegundoFator(email);
    for (let i = 0; i < 3; i++) await verificar(cookie, '000001');

    await request(app).post('/api/auth/login').send({ email, senha: SENHA_TESTE });

    expect((await estado(diretor._id)).twoFactorAttempts).toBe(3);
});

it('errar 2 e acertar entra e zera o contador', async () => {
    const { diretor, cookie } = await diretorNoSegundoFator('dir5.669@escola.test');
    await verificar(cookie, '000001');
    await verificar(cookie, '000002');

    const certo = await verificar(cookie, CODIGO);

    expect(certo.status).toBe(200);
    expect((certo.headers['set-cookie'] || []).some((c) => c.startsWith('escola_jwt='))).toBe(true);
    expect((await estado(diretor._id)).twoFactorAttempts).toBe(0);
});
