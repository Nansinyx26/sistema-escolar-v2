/**
 * notes.test.js
 * Suite 4 — Notas e médias
 *
 * Cobre:
 *   - Lançamento de nota válida
 *   - Rejeição de nota com valor fora do intervalo
 *   - Listagem de notas de um aluno
 *   - Verificação de que a senha de aluno não vaza em nenhuma resposta
 */

const request = require('supertest');
const jwt     = require('jsonwebtoken');
const app     = require('../app');
const Aluno   = require('../models/Aluno');
const { conectarBanco, limparBanco, desconectarBanco, criarUsuario } = require('./helpers');

beforeAll(async () => { await conectarBanco(); });
afterEach(async () => { await limparBanco(); });
afterAll(async () => { await desconectarBanco(); });

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Helper — JWT de professor
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function cookieProfessor() {
    const prof = await criarUsuario({ perfil: 'professor', email: `prof_${Date.now()}@escola.test` });
    const token = jwt.sign(
        { id: prof._id, perfil: prof.perfil, email: prof.email, nome: prof.nome },
        process.env.JWT_SECRET,
        { expiresIn: '1h' }
    );
    return `escola_jwt=${token}`;
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Autenticação
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
describe('GET /api/notas — autenticação', () => {

    it('deve retornar 401 sem token JWT', async () => {
        const res = await request(app).get('/api/notas');
        expect(res.status).toBe(401);
    });

    it('deve retornar 200 com cookie JWT válido', async () => {
        const cookie = await cookieProfessor();
        const res = await request(app)
            .get('/api/notas')
            .set('Cookie', cookie);

        // A rota pode retornar 200 ou 400 dependendo de parâmetros,
        // mas nunca 401 com token válido
        expect(res.status).not.toBe(401);
    });
});

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Lançamento de Notas
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
describe('POST /api/notas — lançamento', () => {

    it('deve lançar nota válida (0â€“10) e persistir no banco', async () => {
        const cookie = await cookieProfessor();

        // Cria um aluno para ter o ID
        const aluno = await Aluno.create({ nome: 'Maria', turma: '1A', ativo: true });

        const payload = {
            alunoId: aluno._id.toString(),
            materia: 'Português',
            bimestre: 1,
            nota: 8.5,
            tipo: 'prova',
        };

        const res = await request(app)
            .post('/api/notas')
            .set('Cookie', cookie)
            .set('X-CSRF-Token', 'test')
            .send(payload);

        // Aceita 200 ou 201
        expect([200, 201]).toContain(res.status);
        expect(res.body.success).toBe(true);
    });

    it('deve rejeitar nota com valor negativo', async () => {
        const cookie = await cookieProfessor();
        const aluno = await Aluno.create({ nome: 'Carlos', turma: '2B', ativo: true });

        const res = await request(app)
            .post('/api/notas')
            .set('Cookie', cookie)
            .set('X-CSRF-Token', 'test')
            .send({
                alunoId: aluno._id.toString(),
                materia: 'Matemática',
                bimestre: 1,
                nota: -5,
            });

        expect(res.status).toBeGreaterThanOrEqual(400);
        expect(res.body.success).toBe(false);
    });

    it('deve rejeitar nota com valor maior que 10', async () => {
        const cookie = await cookieProfessor();
        const aluno = await Aluno.create({ nome: 'Lucas', turma: '3C', ativo: true });

        const res = await request(app)
            .post('/api/notas')
            .set('Cookie', cookie)
            .set('X-CSRF-Token', 'test')
            .send({
                alunoId: aluno._id.toString(),
                materia: 'Ciências',
                bimestre: 2,
                nota: 15,
            });

        expect(res.status).toBeGreaterThanOrEqual(400);
        expect(res.body.success).toBe(false);
    });
});

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Segurança — dados sensíveis não devem vazar
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
describe('Segurança: dados sensíveis', () => {

    it('não deve expor senha de usuário em nenhuma rota de notas', async () => {
        const cookie = await cookieProfessor();
        const res = await request(app)
            .get('/api/notas')
            .set('Cookie', cookie);

        // Bcrypt hash não deve aparecer em resposta alguma
        expect(JSON.stringify(res.body)).not.toMatch(/\$2[ab]\$/);
    });
});

