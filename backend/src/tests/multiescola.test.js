/**
 * multiescola.test.js
 * Fluxos do suporte multi-escola: listagem pública, cadastro com escola
 * pré-selecionada, validação de código por escola, vínculo no login,
 * troca de escola e isolamento de dados por escolaId.
 */
const request = require('supertest');
const app = require('../app');
const { conectarBanco, limparBanco, desconectarBanco, criarUsuario } = require('./helpers');

const Escola = require('../models/Escola');
const Professor = require('../models/Professor');
const Turma = require('../models/Turma');

let escolaA, escolaB, escolaBloqueada;

beforeAll(async () => { await conectarBanco(); });
afterAll(async () => { await desconectarBanco(); });

beforeEach(async () => {
    await limparBanco();
    escolaA = await Escola.create({
        nome: 'CIEP Escola A', tipo: 'CIEP', bairro: 'Bairro A',
        codigoSecreto: 'CODIGO-A-123', ativo: true
    });
    escolaB = await Escola.create({
        nome: 'EMEF Escola B', tipo: 'EMEF', bairro: 'Bairro B',
        codigoSecreto: 'CODIGO-B-456', ativo: true
    });
    escolaBloqueada = await Escola.create({
        nome: 'EMEF Bloqueada', tipo: 'EMEF', bairro: 'Bairro C',
        codigoSecreto: 'CODIGO-C-789', ativo: false
    });
});

// ─────────────────────────────────────────────────────────
// GET /api/escolas — modal público
// ─────────────────────────────────────────────────────────
describe('GET /api/escolas', () => {
    it('lista todas as escolas sem expor codigoSecreto', async () => {
        const res = await request(app).get('/api/escolas');
        expect(res.status).toBe(200);
        expect(res.body.data).toHaveLength(3);
        for (const e of res.body.data) {
            expect(e.codigoSecreto).toBeUndefined();
        }
    });

    it('filtra por tipo EMEF', async () => {
        const res = await request(app).get('/api/escolas?tipo=EMEF');
        expect(res.status).toBe(200);
        expect(res.body.data.every(e => e.tipo === 'EMEF')).toBe(true);
        expect(res.body.data).toHaveLength(2);
    });

    it('inclui o campo ativo (cadeado do modal)', async () => {
        const res = await request(app).get('/api/escolas');
        const bloqueada = res.body.data.find(e => e.nome === 'EMEF Bloqueada');
        expect(bloqueada.ativo).toBe(false);
    });
});

// ─────────────────────────────────────────────────────────
// Cadastro com escola pré-selecionada
// ─────────────────────────────────────────────────────────
describe('POST /api/auth/register-docente (multi-escola)', () => {
    const docente = (extra = {}) => ({
        nome: 'Prof Multi', email: `multi_${Date.now()}@escola.test`, senha: 'SENHA_DE_TESTE_REMOVIDA',
        disciplina: 'Matemática', turma: '1A', matricula: 'M123',
        telefone: '(19) 99999-0000', ...extra
    });

    it('cria vinculo com a escola do escolaId quando o código bate', async () => {
        const body = docente({ escolaId: String(escolaA._id), codigoEscola: 'CODIGO-A-123' });
        const res = await request(app).post('/api/auth/register-docente').send(body);
        expect(res.status).toBe(201);

        const prof = await Professor.findOne({ email: body.email }).lean();
        expect(prof.vinculos).toHaveLength(1);
        expect(prof.vinculos[0].escolaId).toBe(String(escolaA._id));
        expect(prof.vinculos[0].cargo).toBe('professor');
        expect(prof.escola).toBe('CIEP Escola A');
    });

    it('rejeita (403) quando o código é de OUTRA escola', async () => {
        const body = docente({ escolaId: String(escolaA._id), codigoEscola: 'CODIGO-B-456' });
        const res = await request(app).post('/api/auth/register-docente').send(body);
        expect(res.status).toBe(403);
    });

    it('sem escolaId, o código identifica a escola automaticamente', async () => {
        const body = docente({ codigoEscola: 'CODIGO-B-456' });
        const res = await request(app).post('/api/auth/register-docente').send(body);
        expect(res.status).toBe(201);

        const prof = await Professor.findOne({ email: body.email }).lean();
        expect(prof.vinculos[0].escolaId).toBe(String(escolaB._id));
    });

    it('rejeita cadastro em escola bloqueada (ativo:false)', async () => {
        const body = docente({ escolaId: String(escolaBloqueada._id), codigoEscola: 'CODIGO-C-789' });
        const res = await request(app).post('/api/auth/register-docente').send(body);
        expect(res.status).toBe(403);
    });
});

// ─────────────────────────────────────────────────────────
// Login com verificação de vínculo
// ─────────────────────────────────────────────────────────
describe('POST /api/auth/login (multi-escola)', () => {
    async function criarProfessorVinculado(email, escolas) {
        const user = await criarUsuario({ email, perfil: 'professor' });
        await Professor.create({
            idUsuario: String(user._id), nome: user.nome, email,
            vinculos: escolas.map(e => ({ escolaId: String(e._id), cargo: 'professor' })),
            ativo: true
        });
        return user;
    }

    it('403 quando pede escola sem vínculo', async () => {
        await criarProfessorVinculado('so_a@escola.test', [escolaA]);
        const res = await request(app).post('/api/auth/login')
            .send({ email: 'so_a@escola.test', senha: 'SENHA_DE_TESTE_REMOVIDA', escolaId: String(escolaB._id) });
        expect(res.status).toBe(403);
        expect(res.body.error).toMatch(/vínculo/i);
    });

    it('entra normalmente na escola vinculada', async () => {
        await criarProfessorVinculado('so_a2@escola.test', [escolaA]);
        const res = await request(app).post('/api/auth/login')
            .send({ email: 'so_a2@escola.test', senha: 'SENHA_DE_TESTE_REMOVIDA', escolaId: String(escolaA._id) });
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.requiresEscolha).toBeUndefined();
    });

    it('com múltiplos vínculos e sem escolaId, pede escolha com a lista', async () => {
        await criarProfessorVinculado('duplo@escola.test', [escolaA, escolaB]);
        const res = await request(app).post('/api/auth/login')
            .send({ email: 'duplo@escola.test', senha: 'SENHA_DE_TESTE_REMOVIDA' });
        expect(res.status).toBe(200);
        expect(res.body.requiresEscolha).toBe(true);
        expect(res.body.escolas).toHaveLength(2);
    });
});

// ─────────────────────────────────────────────────────────
// Troca de escola + isolamento de dados
// ─────────────────────────────────────────────────────────
describe('Troca de escola e isolamento por escolaId', () => {
    async function agentLogado(email, escolas) {
        const user = await criarUsuario({ email, perfil: 'professor' });
        await Professor.create({
            idUsuario: String(user._id), nome: user.nome, email,
            salaPrincipal: '1A',
            vinculos: escolas.map(e => ({ escolaId: String(e._id), cargo: 'professor' })),
            ativo: true
        });
        const agent = request.agent(app); // persiste cookies (JWT + sessão)
        const login = await agent.post('/api/auth/login')
            .send({ email, senha: 'SENHA_DE_TESTE_REMOVIDA', escolaId: String(escolas[0]._id) });
        expect(login.status).toBe(200);
        return agent;
    }

    it('POST /api/escolas/trocar nega escola sem vínculo (403)', async () => {
        const agent = await agentLogado('trocador@escola.test', [escolaA]);
        const res = await agent.post(`/api/escolas/trocar/${escolaB._id}`);
        expect(res.status).toBe(403);
    });

    it('POST /api/escolas/trocar aceita escola vinculada e devolve redirect', async () => {
        const agent = await agentLogado('trocador2@escola.test', [escolaA, escolaB]);
        const res = await agent.post(`/api/escolas/trocar/${escolaB._id}`);
        expect(res.status).toBe(200);
        expect(res.body.escolaAtivaId).toBe(String(escolaB._id));
        expect(res.body.redirect_to).toBe('/html/dashboard.html');
    });

    it('GET /api/turmas retorna apenas turmas da escola ativa da sessão', async () => {
        await Turma.create({ id: '1A', nome: '1A', ano: 1, escolaId: String(escolaA._id), ativo: true });
        await Turma.create({ id: '1A', nome: '1A', ano: 1, escolaId: String(escolaB._id), ativo: true });
        await Turma.create({ id: '2B', nome: '2B', ano: 2, escolaId: String(escolaB._id), ativo: true });

        const agent = await agentLogado('isolado@escola.test', [escolaA]);
        const res = await agent.get('/api/turmas');
        expect(res.status).toBe(200);
        expect(res.body.data).toHaveLength(1);
        expect(res.body.data[0].escolaId).toBe(String(escolaA._id));
    });

    it('GET /api/escolas/minhas devolve só as escolas vinculadas', async () => {
        const agent = await agentLogado('minhas@escola.test', [escolaA]);
        const res = await agent.get('/api/escolas/minhas');
        expect(res.status).toBe(200);
        expect(res.body.data).toHaveLength(1);
        expect(res.body.data[0].nome).toBe('CIEP Escola A');
        expect(res.body.escolaAtivaId).toBe(String(escolaA._id));
    });
});
