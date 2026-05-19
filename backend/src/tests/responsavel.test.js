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
            .get(`/api/responsavel/frequencia/${aluno._id}`)
            .set('Cookie', cookie);

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        // presence = 2 total classes - 1 absence = 1
        expect(res.body.data.presenca).toBe(1);
        expect(res.body.data.ausencia).toBe(1);
        expect(res.body.data.atraso).toBe(0);
        expect(res.body.data.percentual).toBe(50);
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
            .get(`/api/responsavel/frequencia/${aluno._id}`)
            .set('Cookie', cookie);

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        // Manual absences = 11.
        // calculated presence = 1.
        // minAulas = 11 (manual absences) + 0 (delays) + 1 (presence) = 12.
        // totalAulas becomes 12 (since FrequenciaProfessor only has 2, it adjusts to minAulas).
        // presenca = totalAulas - ausencia = 12 - 11 = 1.
        expect(res.body.data.ausencia).toBe(11);
        expect(res.body.data.presenca).toBe(1);
        expect(res.body.data.percentual).toBe(8); // Math.round((1/12)*100) = 8
    });
});
