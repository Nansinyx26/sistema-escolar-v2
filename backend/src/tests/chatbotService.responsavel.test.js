/**
 * chatbotService.responsavel.test.js
 * Bloco 2: o chatbot responde sobre O ALUNO do responsável, mesmo sem o
 * responsável citar o nome (1 filho vinculado), e sem cair em resposta
 * genérica. Também cobre o bug do shadowing de `process` (a função não
 * pode mais sombrear o global process.env).
 */
const request = require('supertest');
const app = require('../app');
const { conectarBanco, limparBanco, desconectarBanco, criarUsuario, SENHA_TESTE } = require('./helpers');

const Usuario = require('../models/Usuario');
const Aluno = require('../models/Aluno');
const Nota = require('../models/Nota');
const Falta = require('../models/Falta');
const ChatbotService = require('../services/ChatbotService');

beforeAll(async () => { await conectarBanco(); });
afterAll(async () => { await desconectarBanco(); });
beforeEach(async () => { await limparBanco(); });

async function cenarioResponsavelComFilho() {
    const pai = await criarUsuario({ email: 'resp@escola.test', perfil: 'responsavel' });
    const aluno = await Aluno.create({
        nome: 'Lucas Andrade', turma: '4B', turmaId: '4B', ativo: true,
        responsavel: 'resp@escola.test'
    });
    await Nota.create({ alunoId: String(aluno._id), turmaId: '4B', materiaId: 'Matemática', bimestre: 1, nota: 5.0, data: new Date() });
    await Nota.create({ alunoId: String(aluno._id), turmaId: '4B', materiaId: 'Ciências', bimestre: 1, nota: 9.0, data: new Date() });
    await Falta.create({ aluno: String(aluno._id), turma: '4B', data: new Date(), presente: false });
    await Falta.create({ aluno: String(aluno._id), turma: '4B', data: new Date(), presente: true });
    return { pai, aluno };
}

const ctx = (pai) => ({
    perfil: 'responsavel',
    userId: String(pai._id),
    nomeUsuario: pai.nome,
    userEmail: pai.email,
});

describe('Chatbot do responsável — contexto do aluno vinculado', () => {
    it('process() não quebra ao acessar env (sem shadowing de process)', async () => {
        const { pai } = await cenarioResponsavelComFilho();
        // Se a função "process" sombrear o global, isto lança TypeError
        await expect(
            ChatbotService.process({ message: 'olá', ...ctx(pai) })
        ).resolves.toHaveProperty('response');
    });

    it('"notas do meu filho" resolve o único filho sem pedir o nome', async () => {
        const { pai } = await cenarioResponsavelComFilho();
        const r = await ChatbotService.process({ message: 'quais as notas do meu filho?', ...ctx(pai) });
        expect(r.response).toContain('Lucas Andrade');
        expect(r.response).toContain('Matemática');
        expect(r.response).not.toMatch(/informe o nome/i);
    });

    it('"e as faltas?" também resolve o filho e mostra a frequência', async () => {
        const { pai } = await cenarioResponsavelComFilho();
        const r = await ChatbotService.process({ message: 'e as faltas?', ...ctx(pai) });
        expect(r.response).toContain('Lucas Andrade');
        expect(r.response).toMatch(/50\.0%|frequ/i);
    });

    it('"como está meu filho" traz resumo com melhor e pior matéria', async () => {
        const { pai } = await cenarioResponsavelComFilho();
        const r = await ChatbotService.process({ message: 'como está meu filho?', ...ctx(pai) });
        expect(r.response).toContain('Lucas Andrade');
        expect(r.response).toContain('Ciências'); // melhor
        expect(r.response).toContain('Matemática'); // atenção
    });

    it('responsável só vê o próprio filho (RBAC) — não vaza outro aluno', async () => {
        const { pai } = await cenarioResponsavelComFilho();
        // Aluno de outra família
        await Aluno.create({ nome: 'Outro Aluno', turma: '4B', turmaId: '4B', ativo: true, responsavel: 'outro@escola.test' });
        const r = await ChatbotService.process({ message: 'notas do Outro Aluno', ...ctx(pai) });
        expect(r.response).not.toContain('Outro Aluno');
    });

    it('POST /api/ia/chatbot responde ao responsável autenticado', async () => {
        const { pai } = await cenarioResponsavelComFilho();
        await Usuario.updateOne({ _id: pai._id }, { $set: { senha: pai.senha } });
        const agent = request.agent(app);
        const login = await agent.post('/api/auth/login').send({ email: 'resp@escola.test', senha: SENHA_TESTE });
        expect(login.status).toBe(200);
        const csrf = decodeURIComponent(((login.headers['set-cookie'] || []).join(';').match(/csrf_token=([^;]+)/) || [])[1] || '');
        const res = await agent.post('/api/ia/chatbot').set('X-CSRF-Token', csrf).send({ message: 'notas do meu filho' });
        expect(res.status).toBe(200);
        expect(res.body.data.response).toContain('Lucas Andrade');
    });
});
