/**
 * redefinicaoPelaGestaoComHash.test.js — Issue #677
 *
 * A redefinição de senha pedida pela gestão passava pelo PasswordRecoveryService,
 * que gravava o código em texto puro. A conferência só aceita `salt:hash`, então
 * o código que chegava ao titular nunca funcionava. Agora os dois caminhos usam
 * o mesmo gerador do "esqueci minha senha".
 */
const request = require('supertest');
const app = require('../app');
const Escola = require('../models/Escola');
const Usuario = require('../models/Usuario');
const RecuperacaoSenha = require('../models/RecuperacaoSenha');
const EmailService = require('../services/EmailService');
const { conectarBanco, limparBanco, desconectarBanco, criarUsuario } = require('./helpers');
const { assinarTokenSessao } = require('../utils/sessionToken');
const { invalidarCacheEscolas } = require('../middleware/filtrarPorEscola');

const NOVA_SENHA = 'NovaSenha#2026';
let diretor;
let professor;
let espiaoEnvio;

const cookieDe = (u) => [`escola_jwt=${assinarTokenSessao(u)}`];
/** Código que foi para o e-mail na última chamada do envio. */
const codigoEnviado = () => espiaoEnvio.mock.calls.at(-1)[1];

beforeAll(async () => {
    await conectarBanco();
});
afterAll(async () => {
    await desconectarBanco();
});
beforeEach(async () => {
    await limparBanco();
    const escola = await Escola.create({ nome: 'EMEF Senha', tipo: 'EMEF', ativo: true });
    diretor = await criarUsuario({
        email: 'diretor.677@escola.test',
        perfil: 'diretor',
        escolaId: String(escola._id),
    });
    professor = await criarUsuario({
        email: 'prof.677@escola.test',
        perfil: 'professor',
        escolaId: String(escola._id),
    });
    invalidarCacheEscolas();
    espiaoEnvio = jest.spyOn(EmailService, 'sendVerificationCode').mockResolvedValue(true);
});
afterEach(() => {
    espiaoEnvio.mockRestore();
});

const pedirPelaDirecao = (alvo) =>
    request(app).post(`/api/usuarios/${alvo._id}/redefinir-senha`).set('Cookie', cookieDe(diretor));

it('o banco guarda só o hash do código pedido pela direção', async () => {
    const res = await pedirPelaDirecao(professor);

    expect(res.status).toBe(200);
    const pedido = await RecuperacaoSenha.findOne({
        usuarioId: professor._id,
        status: 'ativo',
    }).lean();
    expect(pedido.codigo).toMatch(/^[0-9a-f]+:[0-9a-f]+$/);
    expect(pedido.codigo).not.toContain(codigoEnviado());
});

it('o código que chega ao titular confere e redefine a senha', async () => {
    await pedirPelaDirecao(professor);
    const codigo = codigoEnviado();

    const conferido = await request(app)
        .post('/api/auth/verify-recovery-code')
        .send({ email: professor.email, codigo });
    expect(conferido.status).toBe(200);

    const redefinido = await request(app)
        .post('/api/auth/reset-password')
        .send({ email: professor.email, codigo, password: NOVA_SENHA });
    expect(redefinido.status).toBe(200);

    const login = await request(app)
        .post('/api/auth/login')
        .send({ email: professor.email, senha: NOVA_SENHA });
    expect(login.status).toBe(200);
});

it('um pedido novo invalida o código anterior', async () => {
    await pedirPelaDirecao(professor);
    const primeiro = codigoEnviado();
    await pedirPelaDirecao(professor);

    const res = await request(app)
        .post('/api/auth/verify-recovery-code')
        .send({ email: professor.email, codigo: primeiro });

    // O segundo código só repete o primeiro por acaso (1 em 900 mil).
    if (codigoEnviado() !== primeiro) expect(res.status).toBe(400);
    expect(
        await RecuperacaoSenha.countDocuments({ usuarioId: professor._id, status: 'ativo' })
    ).toBe(1);
});

it('conta desativada responde 409 e não gera código', async () => {
    await Usuario.updateOne({ _id: professor._id }, { ativo: false });

    const res = await pedirPelaDirecao(professor);

    expect(res.status).toBe(409);
    expect(espiaoEnvio).not.toHaveBeenCalled();
    expect(await RecuperacaoSenha.countDocuments({})).toBe(0);
});
