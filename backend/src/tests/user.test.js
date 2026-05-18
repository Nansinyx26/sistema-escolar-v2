/**
 * user.test.js
 * Suite 2 — Primeiro acesso e reset de senha
 */

const request   = require('supertest');
const bcrypt    = require('bcryptjs');
const app       = require('../app');
const Usuario   = require('../models/Usuario');
const Professor = require('../models/Professor');
const { conectarBanco, limparBanco, desconectarBanco, criarUsuario } = require('./helpers');

beforeAll(async () => { await conectarBanco(); });
afterEach(async () => { await limparBanco(); });
afterAll(async () => { await desconectarBanco(); });

// ─────────────────────────────────────────────────────────
// Primeiro Acesso
// ─────────────────────────────────────────────────────────
describe('POST /api/auth/first-access', () => {

    it('deve rejeitar professor nao pre-cadastrado com 404', async () => {
        const res = await request(app)
            .post('/api/auth/first-access')
            .send({ emailOrCpf: 'naoexiste@escola.test', password: 'Senha@123' });

        expect(res.status).toBe(404);
        expect(res.body.success).toBe(false);
    });

    it('deve rejeitar senha fraca com 400', async () => {
        const res = await request(app)
            .post('/api/auth/first-access')
            .send({ emailOrCpf: 'qualquer@escola.test', password: '123' });

        expect(res.status).toBe(400);
        // Mensagem contém "8 caracteres"
        expect(res.body.error).toMatch(/8 caracteres/i);
    });

    it('deve ativar conta de professor pre-cadastrado com sucesso', async () => {
        await Professor.create({
            nome: 'Joana Silva',
            email: 'joana@escola.test',
            cpf: '12345678900',
            telefone: '(11) 91111-2222',
        });

        const res = await request(app)
            .post('/api/auth/first-access')
            .send({ emailOrCpf: 'joana@escola.test', password: 'SenhaForte@123' });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);

        const usuario = await Usuario.findOne({ email: 'joana@escola.test' });
        expect(usuario).not.toBeNull();
        expect(usuario.ativo).toBe(true);
        expect(usuario.senha).toMatch(/^\$2[ab]\$/);
    });

    it('deve bloquear segundo acesso se conta ja tiver senha definida', async () => {
        const senhaHash = await bcrypt.hash('SenhaJaDefinida@456', 12);
        await Professor.create({ nome: 'Carlos', email: 'carlos@escola.test' });
        await Usuario.create({
            nome: 'Carlos',
            email: 'carlos@escola.test',
            senha: senhaHash, // hash bcrypt real e valido
            cpf: '99988877766',
            telefone: '(11) 99999-9999',
            perfil: 'professor',
            ativo: true,
        });

        const res = await request(app)
            .post('/api/auth/first-access')
            .send({ emailOrCpf: 'carlos@escola.test', password: 'SenhaForte@123' });

        expect(res.status).toBe(400);
    });
});

// ─────────────────────────────────────────────────────────
// Reset de senha
// ─────────────────────────────────────────────────────────
describe('POST /api/auth/reset-password', () => {

    it('deve rejeitar token invalido com 400', async () => {
        const res = await request(app)
            .post('/api/auth/reset-password')
            .send({ token: 'token-invalido-abc', password: 'NovaSenha@123' });

        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
    });

    it('deve resetar senha com token valido e nao expirado', async () => {
        const token = 'token-valido-jest-abc123';
        await Usuario.create({
            nome: 'Reset User',
            email: 'reset@escola.test',
            senha: '$2a$12$' + 'b'.repeat(53),
            cpf: '11122233344',
            telefone: '(11) 91111-0000',
            perfil: 'professor',
            ativo: true,
            resetToken: token,
            resetTokenExpiry: new Date(Date.now() + 10 * 60 * 1000),
        });

        const res = await request(app)
            .post('/api/auth/reset-password')
            .send({ token, password: 'NovaSenha@123' });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);

        // Token deve ter sido removido
        const usuario = await Usuario.findOne({ email: 'reset@escola.test' });
        expect(usuario.resetToken).toBeUndefined();
    });
});
