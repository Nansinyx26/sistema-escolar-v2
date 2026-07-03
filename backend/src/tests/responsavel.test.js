/**
 * responsavel.test.js
 * Test suite for the parent/responsible portal frequency/attendance logic.
 */

const request  = require('supertest');
const jwt      = require('jsonwebtoken');
const app      = require('../app');
const Aluno    = require('../models/Aluno');
const Falta    = require('../models/Falta');
const FrequenciaProfessor = require('../models/FrequenciaProfessor');
const { conectarBanco, limparBanco, desconectarBanco, criarUsuario } = require('./helpers');

beforeAll(async () => { await conectarBanco(); });
afterEach(async () => { await limparBanco(); });
afterAll(async () => { await desconectarBanco(); });

// Helper to generate guardian cookie
async function cookieResponsavel(email) {
    const user = await criarUsuario({ perfil: 'responsavel', email });
    const token = jwt.sign(
        { id: user._id, perfil: user.perfil, email: user.email, nome: user.nome },
        process.env.JWT_SECRET,
        { expiresIn: '1h' }
    );
    return `escola_jwt=${token}`;
}

describe('POST /api/responsavel/vincular', () => {
    it('deve rejeitar código secreto inválido para vínculo', async () => {
        const email = 'responsavel3@escola.test';
        const cookie = await cookieResponsavel(email);

        const res = await request(app)
            .post('/api/responsavel/vincular')
            .set('Cookie', cookie)
            .send({ codigoSecreto: 'abc' });

        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
        expect(res.body.error).toMatch(/código secreto inválido/i);
    });
});

describe('GET /api/responsavel/frequencia/:alunoId', () => {

    it('should correctly calculate attendance from Falta records when no manual override exists', async () => {
        const email = 'responsavel@escola.test';
        const cookie = await cookieResponsavel(email);

        // Create student linked to the responsible
        const aluno = await Aluno.create({
            nome: 'Aluno Teste',
            turma: '1A',
            ativo: true,
            responsavel: email,
            matricula: 'MAT123'
        });

        // Insert 2 Falta records (1 present, 1 absent)
        await Falta.create({
            aluno: String(aluno._id),
            turma: '1A',
            data: new Date(),
            materia: 'Sala Principal',
            presente: true
        });

        await Falta.create({
            aluno: String(aluno._id),
            turma: '1A',
            data: new Date(),
            materia: 'Sala Principal',
            presente: false
        });

        // Also add a lesson registry for this class so totalAulas is populated
        await FrequenciaProfessor.create({
            data: new Date(),
            nomeProfessor: 'Prof. Teste',
            disciplina: 'Sala Principal',
            escola: 'Escola Central',
            classe: '1A',
            quantidadeAulas: 2
        });

        const res = await request(app)
            .get(`/api/responsavel/frequencia/${aluno._id}?dataAtual=2026-05-19`)
            .set('Cookie', cookie);

        if (res.status !== 200) {
            console.error('TEST ERROR BODY 1:', res.body);
        }

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        // On 19/05/2026, 67 school days have elapsed.
        // presence = 67 total classes - 1 absence = 66
        expect(res.body.data.presenca).toBe(66);
        expect(res.body.data.ausencia).toBe(1);
        expect(res.body.data.atraso).toBe(0);
        expect(res.body.data.percentual).toBe(99); // Math.round((66/67)*100) = 99
    });

    it('should correctly use manual/bimestral absences override (faltasBimestre)', async () => {
        const email = 'responsavel2@escola.test';
        const cookie = await cookieResponsavel(email);

        // Create student linked to the responsible, with manual absences of 11 in bimester 1
        const aluno = await Aluno.create({
            nome: 'Aluno Teste Manual',
            turma: '1A',
            ativo: true,
            responsavel: email,
            matricula: 'MAT456',
            faltasBimestre: { '1': 11 }
        });

        // Insert 2 Falta records (1 present, 1 absent)
        await Falta.create({
            aluno: String(aluno._id),
            turma: '1A',
            data: new Date(),
            materia: 'Sala Principal',
            presente: true
        });

        await Falta.create({
            aluno: String(aluno._id),
            turma: '1A',
            data: new Date(),
            materia: 'Sala Principal',
            presente: false
        });

        // Classroom has 2 sessions registered
        await FrequenciaProfessor.create({
            data: new Date(),
            nomeProfessor: 'Prof. Teste',
            disciplina: 'Sala Principal',
            escola: 'Escola Central',
            classe: '1A',
            quantidadeAulas: 2
        });

        const res = await request(app)
            .get(`/api/responsavel/frequencia/${aluno._id}?dataAtual=2026-05-19`)
            .set('Cookie', cookie);

        if (res.status !== 200) {
            console.error('TEST ERROR BODY 2:', res.body);
        }

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        // Manual absences = 11.
        // On 19/05/2026, 67 school days have elapsed.
        // presence = 67 total classes - 11 absences = 56
        expect(res.body.data.ausencia).toBe(11);
        expect(res.body.data.presenca).toBe(56);
        expect(res.body.data.percentual).toBe(84); // Math.round((56/67)*100) = 84
    });
});
