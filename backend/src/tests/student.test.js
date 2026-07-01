/**
 * student.test.js
 * Suite 3 — CRUD de alunos
 *
 * Cobre:
 *   - Listagem exige autenticação (401 sem token)
 *   - Criação de aluno válido
 *   - Busca por turma (filtro)
 *   - Validação de campos obrigatórios
 */

const request  = require('supertest');
const jwt      = require('jsonwebtoken');
const app      = require('../app');
const Aluno    = require('../models/Aluno');
const { conectarBanco, limparBanco, desconectarBanco, criarUsuario } = require('./helpers');

beforeAll(async () => { await conectarBanco(); });
afterEach(async () => { await limparBanco(); });
afterAll(async () => { await desconectarBanco(); });

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Helper — cookie JWT de admin para rotas protegidas
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function cookieAdmin() {
    const admin = await criarUsuario({ perfil: 'admin', email: `admin_${Date.now()}@escola.test` });
    const token = jwt.sign(
        { id: admin._id, perfil: admin.perfil, email: admin.email, nome: admin.nome },
        process.env.JWT_SECRET,
        { expiresIn: '1h' }
    );
    return `escola_jwt=${token}`;
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Autenticação nas rotas de alunos
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
describe('GET /api/alunos — autenticação', () => {

    it('deve retornar 401 sem cookie JWT', async () => {
        const res = await request(app).get('/api/alunos');
        expect(res.status).toBe(401);
    });

    it('deve retornar 200 com cookie JWT válido de admin', async () => {
        const cookie = await cookieAdmin();
        const res = await request(app)
            .get('/api/alunos')
            .set('Cookie', cookie);

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
    });
});

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// CRUD de alunos
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
describe('POST /api/alunos — criação', () => {

    it('deve rejeitar aluno sem nome com erro de validação', async () => {
        const cookie = await cookieAdmin();
        const res = await request(app)
            .post('/api/alunos')
            .set('Cookie', cookie)
            .set('X-CSRF-Token', 'test')
            .send({ turma: '1A' }); // sem nome

        expect(res.status).toBeGreaterThanOrEqual(400);
        expect(res.body.success).toBe(false);
    });

    it('deve criar aluno válido e retornar 201', async () => {
        const cookie = await cookieAdmin();
        const res = await request(app)
            .post('/api/alunos')
            .set('Cookie', cookie)
            .set('X-CSRF-Token', 'test')
            .send({
                nome: 'Aluno Teste',
                turma: '1A',
                ativo: true,
            });

        expect(res.status).toBe(201);
        expect(res.body.success).toBe(true);
        expect(res.body.data.nome).toBe('Aluno Teste');
    });
});

describe('GET /api/alunos — filtragem por turma', () => {

    it('deve retornar somente alunos da turma solicitada', async () => {
        const cookie = await cookieAdmin();

        // Cria dois alunos em turmas diferentes
        await Aluno.create({ nome: 'Ana', turma: '1A', ativo: true });
        await Aluno.create({ nome: 'Bruno', turma: '2B', ativo: true });

        const res = await request(app)
            .get('/api/alunos?turma=1A')
            .set('Cookie', cookie);

        expect(res.status).toBe(200);
        const nomes = res.body.data.map(a => a.nome);
        expect(nomes).toContain('Ana');
        expect(nomes).not.toContain('Bruno');
    });
});

describe('GET /api/alunos/codigos-secretos', () => {
    it('deve gerar e retornar código secreto para aluno sem código', async () => {
        const cookie = await cookieAdmin();
        const aluno = await Aluno.create({ nome: 'Carlos', turma: '1A', ativo: true });

        const res = await request(app)
            .get('/api/alunos/codigos-secretos')
            .set('Cookie', cookie);

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data.some(item => item.nome.includes('Carlos'))).toBe(true);

        const alunoAtualizado = await Aluno.findById(aluno._id);
        expect(alunoAtualizado.codigoSecreto).toBeTruthy();
        expect(alunoAtualizado.codigoSecreto).not.toBe('N/A');
    });
});

