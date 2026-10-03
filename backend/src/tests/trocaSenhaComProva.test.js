/**
 * trocaSenhaComProva.test.js — Issue #590
 *
 * Duas rotas trocavam a senha só com a sessão:
 *   - PUT /api/usuarios/:id na própria conta (sem a senha atual, sem regra de
 *     força, e um valor com cara de hash bcrypt era gravado como veio);
 *   - POST /api/auth/update-password-force, que não conferia deveMudarSenha e
 *     não derrubava as outras sessões.
 */
const request = require('supertest');
const bcrypt = require('bcryptjs');
const app = require('../app');
const Usuario = require('../models/Usuario');
const AuditLog = require('../models/AuditLog');
const {
    conectarBanco,
    limparBanco,
    desconectarBanco,
    criarUsuario,
    SENHA_TESTE,
} = require('./helpers');
const { assinarTokenSessao } = require('../utils/sessionToken');

const SENHA_FORTE = 'NovaSenha2026';

beforeAll(async () => {
    await conectarBanco();
});
afterAll(async () => {
    await desconectarBanco();
});
beforeEach(async () => {
    await limparBanco();
});

const cookieDe = (u) => [`escola_jwt=${assinarTokenSessao(u)}`];
const hashDe = async (id) => (await Usuario.findById(id).select('+senha').lean()).senha;

describe('PUT /api/usuarios/:id não troca senha (Issue #590)', () => {
    it('hash bcrypt vindo de ida e volta é ignorado — nunca gravado', async () => {
        const conta = await criarUsuario({ perfil: 'responsavel' });
        const antes = await hashDe(conta._id);
        const hashForjado = await bcrypt.hash('SenhaQueEuEscolhi1', 4);

        const res = await request(app)
            .put(`/api/usuarios/${conta._id}`)
            .set('Cookie', cookieDe(conta))
            .send({ nome: 'Nome Novo', senha: hashForjado });

        expect(res.status).toBe(200);
        expect(await hashDe(conta._id)).toBe(antes);
        expect((await Usuario.findById(conta._id).lean()).nome).toBe('Nome Novo');
    });

    it('senha em texto é recusada e a tentativa vai para a auditoria', async () => {
        const conta = await criarUsuario({ perfil: 'responsavel' });
        const antes = await hashDe(conta._id);

        const res = await request(app)
            .put(`/api/usuarios/${conta._id}`)
            .set('Cookie', cookieDe(conta))
            .send({ senha: SENHA_FORTE });

        expect(res.status).toBe(400);
        expect(res.body.codigo).toBe('SENHA_PELA_RECUPERACAO');
        expect(await hashDe(conta._id)).toBe(antes);
        expect(await AuditLog.countDocuments({ acao: 'TROCA_SENHA_SEM_PROVA_RECUSADA' })).toBe(1);
    });
});

describe('POST /api/auth/update-password-force (Issue #590)', () => {
    it('conta sem troca obrigatória pendente é recusada', async () => {
        const conta = await criarUsuario({ perfil: 'responsavel', deveMudarSenha: false });
        const antes = await hashDe(conta._id);

        const res = await request(app)
            .post('/api/auth/update-password-force')
            .set('Cookie', cookieDe(conta))
            .send({ password: SENHA_FORTE });

        expect(res.status).toBe(403);
        expect(res.body.codigo).toBe('TROCA_OBRIGATORIA_INEXISTENTE');
        expect(await hashDe(conta._id)).toBe(antes);
        expect(await AuditLog.countDocuments({ acao: 'TROCA_SENHA_FORCADA_RECUSADA' })).toBe(1);
    });

    it.each([
        ['curta', 'Ab1'],
        ['sem maiúscula', 'semmaiuscula1'],
        ['sem número', 'SemNumeroAqui'],
    ])('senha %s é recusada mesmo com a troca pendente', async (_motivo, senha) => {
        const conta = await criarUsuario({ perfil: 'professor', deveMudarSenha: true });

        const res = await request(app)
            .post('/api/auth/update-password-force')
            .set('Cookie', cookieDe(conta))
            .send({ password: senha });

        expect(res.status).toBe(400);
        expect((await Usuario.findById(conta._id).lean()).deveMudarSenha).toBe(true);
    });

    it('com a troca pendente: grava, libera, derruba as outras sessões e mantém esta', async () => {
        const conta = await criarUsuario({ perfil: 'professor', deveMudarSenha: true });
        const cookieAntigo = cookieDe(conta);

        const res = await request(app)
            .post('/api/auth/update-password-force')
            .set('Cookie', cookieAntigo)
            .send({ password: SENHA_FORTE });

        expect(res.status).toBe(200);
        const depois = await Usuario.findById(conta._id).select('+senha').lean();
        expect(depois.deveMudarSenha).toBe(false);
        expect(await bcrypt.compare(SENHA_FORTE, depois.senha)).toBe(true);
        expect(await bcrypt.compare(SENHA_TESTE, depois.senha)).toBe(false);
        expect(depois.tokenVersion).toBe((conta.tokenVersion || 0) + 1);

        // A sessão antiga (e qualquer cópia dela) morreu...
        const comAntigo = await request(app).get('/api/auth/me').set('Cookie', cookieAntigo);
        expect(comAntigo.status).toBe(401);

        // ...e a resposta trouxe um cookie novo que segue valendo.
        const novo = (res.headers['set-cookie'] || []).find((c) => c.startsWith('escola_jwt='));
        expect(novo).toBeDefined();
        const comNovo = await request(app)
            .get('/api/auth/me')
            .set('Cookie', [novo.split(';')[0]]);
        expect(comNovo.status).toBe(200);
    });
});
