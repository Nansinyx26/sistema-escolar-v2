/**
 * passwordRecovery.test.js
 * Suite — Recuperação de Senha (Forgot Password → Verify Code → Reset)
 *
 * Testa o fluxo completo de 3 passos:
 *   1. POST /api/auth/forgot-password  → gera código de 6 dígitos
 *   2. POST /api/auth/verify-recovery-code → valida o código
 *   3. POST /api/auth/reset-password → redefine a senha
 */

const request = require('supertest');
const bcrypt  = require('bcryptjs');

const app              = require('../app');
const Usuario          = require('../models/Usuario');
const RecuperacaoSenha = require('../models/RecuperacaoSenha');
const { conectarBanco, limparBanco, desconectarBanco, criarUsuario } = require('./helpers');

beforeAll(async () => { await conectarBanco(); });
afterEach(async () => { await limparBanco(); });
afterAll(async () => { await desconectarBanco(); });

// ─────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────
function postForgot(body) {
    return request(app).post('/api/auth/forgot-password').send(body);
}
function postVerify(body) {
    return request(app).post('/api/auth/verify-recovery-code').send(body);
}
function postReset(body) {
    return request(app).post('/api/auth/reset-password').send(body);
}

/** Recupera o código ativo diretamente do banco (simula ler o e-mail) */
async function obterCodigoAtivo(userId) {
    const rec = await RecuperacaoSenha.findOne({ usuarioId: userId, status: 'ativo' });
    return rec ? rec.codigo : null;
}

// ─────────────────────────────────────────────────────────
// STEP 1: POST /api/auth/forgot-password
// ─────────────────────────────────────────────────────────
describe('POST /api/auth/forgot-password', () => {

    it('deve retornar 400 se e-mail não for enviado', async () => {
        const res = await postForgot({});
        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
    });

    it('deve retornar sucesso genérico para e-mail inexistente (anti-harvesting)', async () => {
        const res = await postForgot({ email: 'naoexiste@escola.test' });
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        // Não deve revelar que o e-mail não existe
        expect(res.body.message).toMatch(/se o e-mail estiver cadastrado/i);
    });

    it('deve criar um registro RecuperacaoSenha para e-mail válido', async () => {
        const user = await criarUsuario({ email: 'recovery@escola.test' });
        const res = await postForgot({ email: 'recovery@escola.test' });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);

        const codigo = await obterCodigoAtivo(user._id);
        expect(codigo).toBeTruthy();
        expect(codigo.length).toBe(6);
        expect(/^\d{6}$/.test(codigo)).toBe(true);
    });

    it('deve invalidar códigos anteriores ao gerar um novo', async () => {
        const user = await criarUsuario({ email: 'duplo@escola.test' });

        // Primeiro pedido
        await postForgot({ email: 'duplo@escola.test' });
        const primeiroRegistro = await RecuperacaoSenha.findOne({ usuarioId: user._id, status: 'ativo' });
        expect(primeiroRegistro).toBeTruthy();

        // Segundo pedido
        await postForgot({ email: 'duplo@escola.test' });

        // O primeiro deve ter sido expirado
        const atualizado = await RecuperacaoSenha.findById(primeiroRegistro._id);
        expect(atualizado.status).toBe('expirado');

        // Deve haver exatamente 1 código ativo
        const ativos = await RecuperacaoSenha.find({ usuarioId: user._id, status: 'ativo' });
        expect(ativos.length).toBe(1);
    });
});

// ─────────────────────────────────────────────────────────
// STEP 2: POST /api/auth/verify-recovery-code
// ─────────────────────────────────────────────────────────
describe('POST /api/auth/verify-recovery-code', () => {

    it('deve retornar 400 se e-mail ou código não for enviado', async () => {
        const res1 = await postVerify({ email: 'test@test.com' });
        expect(res1.status).toBe(400);

        const res2 = await postVerify({ codigo: '123456' });
        expect(res2.status).toBe(400);
    });

    it('deve retornar 400 para código incorreto', async () => {
        const user = await criarUsuario({ email: 'codigoerrado@escola.test' });
        await postForgot({ email: 'codigoerrado@escola.test' });

        const res = await postVerify({ email: 'codigoerrado@escola.test', codigo: '000000' });
        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
    });

    it('deve aceitar código correto', async () => {
        const user = await criarUsuario({ email: 'codigocerto@escola.test' });
        await postForgot({ email: 'codigocerto@escola.test' });

        const codigo = await obterCodigoAtivo(user._id);
        const res = await postVerify({ email: 'codigocerto@escola.test', codigo });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
    });

    it('deve rejeitar código expirado', async () => {
        const user = await criarUsuario({ email: 'expirado@escola.test' });
        await postForgot({ email: 'expirado@escola.test' });

        // Força expiração no banco
        await RecuperacaoSenha.updateMany(
            { usuarioId: user._id, status: 'ativo' },
            { $set: { expiraEm: new Date(Date.now() - 1000) } }
        );

        const codigo = await obterCodigoAtivo(user._id);
        const res = await postVerify({ email: 'expirado@escola.test', codigo });
        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/expirado/i);
    });

    it('deve bloquear após 5 tentativas incorretas', async () => {
        const user = await criarUsuario({ email: 'bloqueio@escola.test' });
        await postForgot({ email: 'bloqueio@escola.test' });

        // 5 tentativas erradas
        for (let i = 0; i < 5; i++) {
            await postVerify({ email: 'bloqueio@escola.test', codigo: '000000' });
        }

        // Na 6ª tentativa (com código correto), deve estar bloqueado
        const codigo = await obterCodigoAtivo(user._id);
        // O código pode ter sido invalidado por excesso de tentativas
        const res = await postVerify({ email: 'bloqueio@escola.test', codigo: codigo || '123456' });
        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/bloqueado|expirado|inválido/i);
    });
});

// ─────────────────────────────────────────────────────────
// STEP 3: POST /api/auth/reset-password
// ─────────────────────────────────────────────────────────
describe('POST /api/auth/reset-password', () => {

    it('deve retornar 400 se campos obrigatórios faltarem', async () => {
        const res = await postReset({ email: 'x@x.com', codigo: '123456' });
        expect(res.status).toBe(400);
    });

    it('deve rejeitar senha menor que 8 caracteres', async () => {
        const user = await criarUsuario({ email: 'fracas@escola.test' });
        await postForgot({ email: 'fracas@escola.test' });
        const codigo = await obterCodigoAtivo(user._id);

        const res = await postReset({ email: 'fracas@escola.test', codigo, password: 'Ab1' });
        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/8 caracteres/i);
    });

    it('deve rejeitar senha sem letra maiúscula', async () => {
        const user = await criarUsuario({ email: 'seminaiuscula@escola.test' });
        await postForgot({ email: 'seminaiuscula@escola.test' });
        const codigo = await obterCodigoAtivo(user._id);

        const res = await postReset({ email: 'seminaiuscula@escola.test', codigo, password: 'senhasem1maiuscula' });
        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/maiúscula/i);
    });

    it('deve rejeitar senha sem número', async () => {
        const user = await criarUsuario({ email: 'semnumero@escola.test' });
        await postForgot({ email: 'semnumero@escola.test' });
        const codigo = await obterCodigoAtivo(user._id);

        const res = await postReset({ email: 'semnumero@escola.test', codigo, password: 'SenhaSemNumero' });
        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/número/i);
    });

    it('deve alterar a senha com sucesso e marcar código como utilizado', async () => {
        const user = await criarUsuario({ email: 'resetok@escola.test' });
        await postForgot({ email: 'resetok@escola.test' });
        const codigo = await obterCodigoAtivo(user._id);

        const res = await postReset({
            email: 'resetok@escola.test',
            codigo,
            password: 'NovaSenha@123'
        });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.message).toMatch(/sucesso/i);

        // Verifica que o código foi marcado como 'utilizado'
        const rec = await RecuperacaoSenha.findOne({ usuarioId: user._id });
        expect(rec.status).toBe('utilizado');

        // Verifica que o login funciona com a nova senha
        const loginRes = await request(app)
            .post('/api/auth/login')
            .send({ email: 'resetok@escola.test', senha: 'NovaSenha@123' });
        expect(loginRes.status).toBe(200);
        expect(loginRes.body.success).toBe(true);
    });

    it('não deve permitir reutilizar o mesmo código após reset', async () => {
        const user = await criarUsuario({ email: 'reusar@escola.test' });
        await postForgot({ email: 'reusar@escola.test' });
        const codigo = await obterCodigoAtivo(user._id);

        // Primeiro reset
        await postReset({ email: 'reusar@escola.test', codigo, password: 'NovaSenha@1' });

        // Tentativa de reusar o código
        const res = await postReset({ email: 'reusar@escola.test', codigo, password: 'OutraSenha@2' });
        expect(res.status).toBe(400);
    });
});

// ─────────────────────────────────────────────────────────
// FLUXO COMPLETO — E2E
// ─────────────────────────────────────────────────────────
describe('Fluxo completo E2E: esqueci senha → código → nova senha → login', () => {

    it('deve completar todo o ciclo de recuperação de senha', async () => {
        // 1. Cria usuário com senha original
        const senhaOriginal = 'Senha@123';
        const user = await criarUsuario({ email: 'e2e@escola.test' });

        // Confirma que login original funciona
        const login1 = await request(app)
            .post('/api/auth/login')
            .send({ email: 'e2e@escola.test', senha: senhaOriginal });
        expect(login1.status).toBe(200);

        // 2. Solicita código de recuperação
        const forgotRes = await postForgot({ email: 'e2e@escola.test' });
        expect(forgotRes.status).toBe(200);
        expect(forgotRes.body.success).toBe(true);

        // 3. Obtém código do banco (simula leitura do e-mail)
        const codigo = await obterCodigoAtivo(user._id);
        expect(codigo).toBeTruthy();

        // 4. Verifica o código
        const verifyRes = await postVerify({ email: 'e2e@escola.test', codigo });
        expect(verifyRes.status).toBe(200);
        expect(verifyRes.body.success).toBe(true);

        // 5. Redefine a senha
        const novaSenha = 'NovaSegura@456';
        const resetRes = await postReset({
            email: 'e2e@escola.test',
            codigo,
            password: novaSenha
        });
        expect(resetRes.status).toBe(200);
        expect(resetRes.body.success).toBe(true);

        // 6. Login com senha antiga deve FALHAR
        const loginAntigo = await request(app)
            .post('/api/auth/login')
            .send({ email: 'e2e@escola.test', senha: senhaOriginal });
        expect(loginAntigo.status).toBe(401);

        // 7. Login com nova senha deve FUNCIONAR
        const loginNovo = await request(app)
            .post('/api/auth/login')
            .send({ email: 'e2e@escola.test', senha: novaSenha });
        expect(loginNovo.status).toBe(200);
        expect(loginNovo.body.success).toBe(true);
    });
});
