/**
 * codigoAluno.test.js — botão "Código Secreto do Aluno" (painel Secretaria):
 * listagem restrita por perfil e escola, e regeneração invalidando o anterior.
 */
const request = require('supertest');
const app = require('../app');
const { conectarBanco, limparBanco, desconectarBanco, criarUsuario, SENHA_TESTE } = require('./helpers');

const Aluno = require('../models/Aluno');
const Escola = require('../models/Escola');

beforeAll(async () => { await conectarBanco(); });
afterAll(async () => { await desconectarBanco(); });
beforeEach(async () => { await limparBanco(); });

async function agentPerfil(perfil, email) {
    await criarUsuario({ email, perfil });
    const agent = request.agent(app);
    const res = await agent.post('/api/auth/login').send({ email, senha: SENHA_TESTE });
    // secretaria/diretor exigem 2FA — para o teste usamos admin/professor OU
    // perfis com 2FA usam o fluxo completo; aqui simplificamos com admin
    expect(res.status).toBe(200);
    return agent;
}

describe('GET /api/alunos/codigos-secretos', () => {
    it('professor NÃO pode listar códigos (403)', async () => {
        const agent = await agentPerfil('professor', 'prof_cod@escola.test');
        const res = await agent.get('/api/alunos/codigos-secretos');
        expect(res.status).toBe(403);
    });

    it('admin lista códigos com id do aluno incluído', async () => {
        await Aluno.create({ nome: 'Aluno Cod', turma: '1A', codigoSecreto: 'ABC123', ativo: true });
        const agent = await agentPerfil('admin', 'admin_cod@escola.test');
        const res = await agent.get('/api/alunos/codigos-secretos');
        expect(res.status).toBe(200);
        expect(res.body.data).toHaveLength(1);
        expect(res.body.data[0].codigoSecreto).toBe('ABC123');
        expect(res.body.data[0].id).toBeTruthy();
    });

    it('filtra pela escola ativa da sessão (multi-tenant)', async () => {
        const escolaA = await Escola.create({ nome: 'CIEP Cod A', tipo: 'CIEP', ativo: true });
        const escolaB = await Escola.create({ nome: 'EMEF Cod B', tipo: 'EMEF', ativo: true });
        await Aluno.create({ nome: 'Aluno A', turma: '1A', codigoSecreto: 'AAAAAA', escolaId: String(escolaA._id), ativo: true });
        await Aluno.create({ nome: 'Aluno B', turma: '1A', codigoSecreto: 'BBBBBB', escolaId: String(escolaB._id), ativo: true });

        const agent = await agentPerfil('admin', 'admin_multi@escola.test');
        // Ativa a escola A na sessão
        await agent.post(`/api/escolas/trocar/${escolaA._id}`);

        const res = await agent.get('/api/alunos/codigos-secretos');
        expect(res.status).toBe(200);
        expect(res.body.data).toHaveLength(1);
        expect(res.body.data[0].codigoSecreto).toBe('AAAAAA');
    });
});

describe('POST /api/alunos/:id/regenerar-codigo', () => {
    it('gera código novo e diferente do anterior', async () => {
        const aluno = await Aluno.create({ nome: 'Regen Aluno', turma: '2B', codigoSecreto: 'OLD001', ativo: true });
        const agent = await agentPerfil('admin', 'admin_regen@escola.test');

        const res = await agent.post(`/api/alunos/${aluno._id}/regenerar-codigo`);
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data.codigoSecreto).toBeTruthy();
        expect(res.body.data.codigoSecreto).not.toBe('OLD001');

        const noBanco = await Aluno.findById(aluno._id).lean();
        expect(noBanco.codigoSecreto).toBe(res.body.data.codigoSecreto);
    });

    it('professor não pode regenerar (403)', async () => {
        const aluno = await Aluno.create({ nome: 'Regen Neg', turma: '2B', codigoSecreto: 'OLD002', ativo: true });
        const agent = await agentPerfil('professor', 'prof_regen@escola.test');
        const res = await agent.post(`/api/alunos/${aluno._id}/regenerar-codigo`);
        expect(res.status).toBe(403);
    });

    it('bloqueia regenerar aluno de OUTRA escola (403)', async () => {
        const escolaA = await Escola.create({ nome: 'CIEP Regen A', tipo: 'CIEP', ativo: true });
        const escolaB = await Escola.create({ nome: 'EMEF Regen B', tipo: 'EMEF', ativo: true });
        const alunoB = await Aluno.create({ nome: 'Aluno Outra', turma: '3C', codigoSecreto: 'OLD003', escolaId: String(escolaB._id), ativo: true });

        const agent = await agentPerfil('admin', 'admin_cross@escola.test');
        await agent.post(`/api/escolas/trocar/${escolaA._id}`); // sessão na escola A

        const res = await agent.post(`/api/alunos/${alunoB._id}/regenerar-codigo`);
        expect(res.status).toBe(403);

        const intacto = await Aluno.findById(alunoB._id).lean();
        expect(intacto.codigoSecreto).toBe('OLD003');
    });

    it('404 para aluno inexistente', async () => {
        const agent = await agentPerfil('admin', 'admin_404@escola.test');
        const res = await agent.post('/api/alunos/000000000000000000000000/regenerar-codigo');
        expect(res.status).toBe(404);
    });
});
