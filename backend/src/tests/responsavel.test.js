/**
 * responsavel.test.js
 * Test suite for the parent/responsible portal frequency/attendance logic.
 */

const request  = require('supertest');
const jwt      = require('jsonwebtoken');
const app      = require('../app');
const Aluno    = require('../models/Aluno');
const Falta    = require('../models/Falta');
const Usuario  = require('../models/Usuario');
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

    it('conta origem Google (sem escolaId) herda a escola do aluno ao vincular', async () => {
        const email = 'google.responsavel@escola.test';
        // Simula conta criada via Google (SSO): nasce SEM escolaId.
        const user = await criarUsuario({ perfil: 'responsavel', email, escolaId: undefined });
        expect(user.escolaId).toBeUndefined();

        const token = jwt.sign(
            { id: user._id, perfil: user.perfil, email: user.email, nome: user.nome },
            process.env.JWT_SECRET,
            { expiresIn: '1h' }
        );
        const cookie = `escola_jwt=${token}`;

        const aluno = await Aluno.create({
            nome: 'Aluno Multi Escola',
            turma: '2B',
            ativo: true,
            matricula: 'MAT789',
            codigoSecreto: 'GOOGLE1234',
            escolaId: 'escola-abc-123'
        });

        const res = await request(app)
            .post('/api/responsavel/vincular')
            .set('Cookie', cookie)
            .send({ codigoSecreto: 'GOOGLE1234' });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);

        // A conta deve ter herdado o escolaId do aluno recém-vinculado.
        const contaAtualizada = await Usuario.findById(user._id).lean();
        expect(contaAtualizada.escolaId).toBe('escola-abc-123');

        // E o aluno deve ter sido vinculado ao e-mail do responsável.
        const alunoAtualizado = await Aluno.findById(aluno._id).lean();
        expect(alunoAtualizado.responsavel).toBe(email);
    });

    it('conta que já tem escolaId NÃO é sobrescrita ao vincular aluno de outra escola', async () => {
        const email = 'ja.tem.escola@escola.test';
        const user = await criarUsuario({ perfil: 'responsavel', email, escolaId: 'escola-original' });

        const token = jwt.sign(
            { id: user._id, perfil: user.perfil, email: user.email, nome: user.nome },
            process.env.JWT_SECRET,
            { expiresIn: '1h' }
        );
        const cookie = `escola_jwt=${token}`;

        const aluno = await Aluno.create({
            nome: 'Aluno Outra Escola',
            turma: '3C',
            ativo: true,
            matricula: 'MAT999',
            codigoSecreto: 'OTHER5678',
            escolaId: 'escola-diferente'
        });

        const res = await request(app)
            .post('/api/responsavel/vincular')
            .set('Cookie', cookie)
            .send({ codigoSecreto: 'OTHER5678' });

        expect(res.status).toBe(200);

        const contaAtualizada = await Usuario.findById(user._id).lean();
        expect(contaAtualizada.escolaId).toBe('escola-original');
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

// ─────────────────────────────────────────────────────────
// PUT /api/responsavel/aluno/:alunoId/dados
// Um responsável não pode revogar o acesso do OUTRO responsável:
// `responsaveis[].email` e `responsavelDados.email` são os campos que o
// próprio verifyOwnership consulta para autorizar quem vê a ficha.
// ─────────────────────────────────────────────────────────
describe('PUT /api/responsavel/aluno/:alunoId/dados — não revoga acesso alheio', () => {
    const MAE = 'mae@escola.test';
    const PAI = 'pai@escola.test';

    async function alunoComDoisResponsaveis() {
        return Aluno.create({
            nome: 'Aluno', sobrenome: 'Teste', turma: '1A',
            responsaveis: [
                { nome: 'Mãe', email: MAE },
                { nome: 'Pai', email: PAI }
            ]
        });
    }

    it('NÃO deixa remover o outro responsável da lista', async () => {
        const aluno = await alunoComDoisResponsaveis();
        const cookie = await cookieResponsavel(MAE);

        const res = await request(app)
            .put(`/api/responsavel/aluno/${aluno._id}/dados`)
            .set('Cookie', cookie)
            .send({ responsaveis: [{ nome: 'Mãe', email: MAE }] }); // pai sumiu

        expect(res.status).toBe(403);

        const depois = await Aluno.findById(aluno._id).lean();
        const emails = depois.responsaveis.map(r => r.email);
        expect(emails).toContain(PAI);
    });

    it('NÃO deixa trocar o e-mail do outro responsável por um terceiro', async () => {
        const aluno = await alunoComDoisResponsaveis();
        const cookie = await cookieResponsavel(MAE);

        const res = await request(app)
            .put(`/api/responsavel/aluno/${aluno._id}/dados`)
            .set('Cookie', cookie)
            .send({
                responsaveis: [
                    { nome: 'Mãe', email: MAE },
                    { nome: 'Pai', email: 'atacante@escola.test' }
                ]
            });

        expect(res.status).toBe(403);

        const depois = await Aluno.findById(aluno._id).lean();
        const emails = depois.responsaveis.map(r => r.email);
        expect(emails).toContain(PAI);
        expect(emails).not.toContain('atacante@escola.test');
    });

    it('PERMITE editar os próprios dados sem remover ninguém', async () => {
        const aluno = await alunoComDoisResponsaveis();
        const cookie = await cookieResponsavel(MAE);

        const res = await request(app)
            .put(`/api/responsavel/aluno/${aluno._id}/dados`)
            .set('Cookie', cookie)
            .send({
                responsaveis: [
                    { nome: 'Mãe Atualizada', email: MAE },
                    { nome: 'Pai', email: PAI }
                ],
                guardaLegal: 'compartilhada'
            });

        expect(res.status).toBe(200);

        const depois = await Aluno.findById(aluno._id).lean();
        expect(depois.responsaveis.find(r => r.email === MAE).nome).toBe('Mãe Atualizada');
        expect(depois.responsaveis.map(r => r.email)).toContain(PAI);
        expect(depois.guardaLegal).toBe('compartilhada');
    });
});
