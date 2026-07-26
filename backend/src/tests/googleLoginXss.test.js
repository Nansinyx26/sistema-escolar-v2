/**
 * googleLoginXss.test.js
 * Suite — sanitização de dados vindos do Google (OAuth)
 *
 * POR QUE ESTA SUITE EXISTE
 * -------------------------
 * A sanitização global do app.js cobre req.body/query/params. O nome e a foto
 * do login Google NÃO vêm de lá — vêm de dentro do ID token — então chegavam
 * ao banco crus.
 *
 * O nome de exibição de uma conta Google é escolhido livremente pelo dono dela.
 * Um atacante criava uma conta chamada `<img src=x onerror=...>`, logava, e
 * esse nome ia parar na notificação de cadastro lida pela direção: XSS
 * armazenado cuja origem é externa e não passa por nenhum formulário do sistema.
 */
const request = require('supertest');

// Mock da verificação do Google: devolve o payload que quisermos, sem rede.
jest.mock('google-auth-library', () => ({
    OAuth2Client: jest.fn().mockImplementation(() => ({
        verifyIdToken: jest.fn(async () => ({
            getPayload: () => global.__GOOGLE_PAYLOAD__
        }))
    }))
}));

const app = require('../app');
const Usuario = require('../models/Usuario');
const { conectarBanco, limparBanco, desconectarBanco } = require('./helpers');

beforeAll(async () => { await conectarBanco(); });
afterEach(async () => { await limparBanco(); });
afterAll(async () => { await desconectarBanco(); });

// O controller só usa o caminho de ID Token quando o valor começa com 'eyJ'
const TOKEN_FALSO = 'eyJ.fake.token';

function loginGoogle(payload) {
    global.__GOOGLE_PAYLOAD__ = payload;
    return request(app).post('/api/auth/google-login').send({ token: TOKEN_FALSO });
}

describe('Google login: nome de exibição malicioso', () => {

    it('remove markup do nome antes de gravar', async () => {
        const res = await loginGoogle({
            email: 'atacante@gmail.com',
            name: '<img src=x onerror="fetch(1)">',
            picture: ''
        });
        expect(res.status).toBe(200);

        const salvo = await Usuario.findOne({ email: 'atacante@gmail.com' });
        expect(salvo).not.toBeNull();
        expect(salvo.nome).not.toMatch(/<img|onerror/i);
        expect(salvo.nome).not.toContain('<');
    });

    it('preserva nome legitimo com acentos', async () => {
        const res = await loginGoogle({
            email: 'joana@gmail.com',
            name: 'Joana Dávila Conceição',
            picture: ''
        });
        expect(res.status).toBe(200);

        const salvo = await Usuario.findOne({ email: 'joana@gmail.com' });
        expect(salvo.nome).toBe('Joana Dávila Conceição');
    });

    it('cai para o prefixo do e-mail quando o nome era so markup', async () => {
        // `<script>x</script>` vira string vazia após a limpeza — sem fallback a
        // conta ficaria com nome em branco na interface.
        const res = await loginGoogle({
            email: 'vazio@gmail.com',
            name: '<script>alert(1)</script>',
            picture: ''
        });
        expect(res.status).toBe(200);

        const salvo = await Usuario.findOne({ email: 'vazio@gmail.com' });
        expect(salvo.nome).toBe('vazio');
    });

    it('limita o tamanho do nome', async () => {
        const res = await loginGoogle({
            email: 'longo@gmail.com',
            name: 'A'.repeat(5000),
            picture: ''
        });
        expect(res.status).toBe(200);

        const salvo = await Usuario.findOne({ email: 'longo@gmail.com' });
        expect(salvo.nome.length).toBeLessThanOrEqual(120);
    });
});

describe('Google login: foto de perfil', () => {

    it('aceita URL legitima do Google', async () => {
        const url = 'https://lh3.googleusercontent.com/a/abc123';
        const res = await loginGoogle({ email: 'foto-ok@gmail.com', name: 'Ana', picture: url });
        expect(res.status).toBe(200);

        const salvo = await Usuario.findOne({ email: 'foto-ok@gmail.com' });
        expect(salvo.fotoGoogle).toBe(url);
    });

    it.each([
        ['host de terceiro', 'https://evil.example.com/x.png'],
        ['esquema javascript', 'javascript:alert(1)'],
        ['aspas para quebrar o atributo', 'https://lh3.googleusercontent.com/a" onerror="alert(1)'],
        ['http sem TLS', 'http://lh3.googleusercontent.com/a']
    ])('rejeita foto: %s', async (_rotulo, url) => {
        const email = `foto-${Math.random().toString(36).slice(2)}@gmail.com`;
        const res = await loginGoogle({ email, name: 'Ana', picture: url });
        expect(res.status).toBe(200);

        const salvo = await Usuario.findOne({ email });
        expect(salvo.fotoGoogle || '').toBe('');
    });
});
