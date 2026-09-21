/**
 * senhaDoTitular.regressao.test.js — Issue #411
 *
 * A direção podia gravar a senha de professor e secretaria pelo
 * `PUT /api/usuarios/:id`. Quem define a senha de alguém entra como esse
 * alguém — e, daí em diante, o `AuditLog` atribui a ele o que for feito.
 *
 * Agora a senha só é aceita na própria conta; a gestão dispara a redefinição
 * por e-mail, sem nunca conhecer a senha.
 */
const request = require('supertest');
const bcrypt = require('bcryptjs');
const app = require('../app');
const Escola = require('../models/Escola');
const Usuario = require('../models/Usuario');
const AuditLog = require('../models/AuditLog');
const RecuperacaoSenha = require('../models/RecuperacaoSenha');
const {
    conectarBanco,
    limparBanco,
    desconectarBanco,
    criarUsuario,
    SENHA_TESTE,
    SENHA_TESTE_NOVA,
} = require('./helpers');
const { assinarTokenSessao } = require('../utils/sessionToken');
const { invalidarCacheEscolas } = require('../middleware/filtrarPorEscola');

let escola;
let diretor;
let professor;

function cookieDe(u) {
    return [`escola_jwt=${assinarTokenSessao(u)}`];
}

async function hashDe(id) {
    return (await Usuario.findById(id).select('+senha').lean()).senha;
}

beforeAll(async () => {
    await conectarBanco();
});
afterAll(async () => {
    await desconectarBanco();
});
beforeEach(async () => {
    await limparBanco();
    escola = await Escola.create({ nome: 'EMEF Senha', tipo: 'EMEF', ativo: true });
    diretor = await criarUsuario({
        email: 'diretor@escola.test',
        perfil: 'diretor',
        escolaId: String(escola._id),
    });
    professor = await criarUsuario({
        email: 'prof@escola.test',
        perfil: 'professor',
        escolaId: String(escola._id),
    });
    invalidarCacheEscolas();
});

describe('ninguém grava a senha de outra pessoa', () => {
    it('diretor mandando senha de professor → 403, hash intacto e registro no AuditLog', async () => {
        const antes = await hashDe(professor._id);

        const res = await request(app)
            .put(`/api/usuarios/${professor._id}`)
            .set('Cookie', cookieDe(diretor))
            .send({ senha: 'SenhaEscolhidaPorOutro#1' });

        expect(res.status).toBe(403);
        expect(res.body.codigo).toBe('SENHA_SO_DO_TITULAR');
        expect(await hashDe(professor._id)).toBe(antes);

        const log = await AuditLog.findOne({ acao: 'SENHA_DE_TERCEIRO_RECUSADA' }).lean();
        expect(log).toBeTruthy();
        expect(String(log.recursoId)).toBe(String(professor._id));
    });

    it('admin também não: a conta não é dele', async () => {
        const admin = await criarUsuario({
            email: 'admin@escola.test',
            perfil: 'admin',
            escolaId: String(escola._id),
        });
        const antes = await hashDe(professor._id);

        const res = await request(app)
            .put(`/api/usuarios/${professor._id}`)
            .set('Cookie', cookieDe(admin))
            .send({ senha: 'SenhaEscolhidaPorOutro#1' });

        expect(res.status).toBe(403);
        expect(await hashDe(professor._id)).toBe(antes);
    });

    it('o titular troca a própria senha normalmente', async () => {
        const res = await request(app)
            .put(`/api/usuarios/${professor._id}`)
            .set('Cookie', cookieDe(professor))
            .send({ senha: SENHA_TESTE_NOVA });

        expect(res.status).toBeLessThan(300);
        const agora = await hashDe(professor._id);
        expect(await bcrypt.compare(SENHA_TESTE_NOVA, agora)).toBe(true);
        expect(await bcrypt.compare(SENHA_TESTE, agora)).toBe(false);
    });

    it('a direção continua editando o resto da conta da equipe', async () => {
        const res = await request(app)
            .put(`/api/usuarios/${professor._id}`)
            .set('Cookie', cookieDe(diretor))
            .send({ telefone: '(19) 99999-0000' });

        expect(res.status).toBeLessThan(300);
        expect((await Usuario.findById(professor._id).lean()).telefone).toBe('(19) 99999-0000');
    });
});

describe('a direção pede a redefinição, o titular conclui', () => {
    it('cria o código, registra no AuditLog e não devolve senha nenhuma', async () => {
        const res = await request(app)
            .post(`/api/usuarios/${professor._id}/redefinir-senha`)
            .set('Cookie', cookieDe(diretor));

        expect(res.status).toBe(200);
        expect(JSON.stringify(res.body)).not.toMatch(/senha["']?\s*:/i);

        const pedido = await RecuperacaoSenha.findOne({
            usuarioId: String(professor._id),
            status: 'ativo',
        }).lean();
        expect(pedido).toBeTruthy();

        const log = await AuditLog.findOne({ acao: 'SENHA_REDEFINICAO_SOLICITADA' }).lean();
        expect(log).toBeTruthy();
        expect(String(log.recursoId)).toBe(String(professor._id));
    });

    it('diretor de outra escola não alcança a conta', async () => {
        const outra = await Escola.create({ nome: 'EMEF Outra', tipo: 'EMEF', ativo: true });
        const forasteiro = await criarUsuario({
            email: 'diretor@outra.test',
            perfil: 'diretor',
            escolaId: String(outra._id),
        });
        invalidarCacheEscolas();

        const res = await request(app)
            .post(`/api/usuarios/${professor._id}/redefinir-senha`)
            .set('Cookie', cookieDe(forasteiro));

        expect(res.status).toBe(403);
        expect(await RecuperacaoSenha.countDocuments({ status: 'ativo' })).toBe(0);
    });
});
