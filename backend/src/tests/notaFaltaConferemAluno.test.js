/**
 * notaFaltaConferemAluno.test.js — Issue #661
 *
 * Nota e falta eram gravadas na ficha de qualquer criança pelo RA ou pelo id:
 * `matriculaId` vinha livre do corpo, a gestão não tinha o aluno conferido, e o
 * lançamento por avaliação aceitava qualquer `alunoId`. O portal da família
 * junta nota e falta pela matrícula. Os testes passam pela rota, com duas
 * escolas ativas.
 */
const request = require('supertest');
const app = require('../app');
const Escola = require('../models/Escola');
const Aluno = require('../models/Aluno');
const Diretor = require('../models/Diretor');
const Professor = require('../models/Professor');
const Turma = require('../models/Turma');
const Nota = require('../models/Nota');
const Falta = require('../models/Falta');
const Avaliacao = require('../models/Avaliacao');
const { conectarBanco, limparBanco, desconectarBanco, criarUsuario } = require('./helpers');
const { assinarTokenSessao } = require('../utils/sessionToken');
const { invalidarCacheEscolas } = require('../middleware/filtrarPorEscola');

let A;
let B;

beforeAll(async () => {
    await conectarBanco();
});
afterAll(async () => {
    await desconectarBanco();
});
beforeEach(async () => {
    await limparBanco();
    A = String((await Escola.create({ nome: 'EMEF Alfa', tipo: 'EMEF', ativo: true }))._id);
    B = String((await Escola.create({ nome: 'EMEF Beta', tipo: 'EMEF', ativo: true }))._id);
    invalidarCacheEscolas();
});

const cookieDe = (usuario) => [`escola_jwt=${assinarTokenSessao(usuario)}`];

async function professorDa1A(escolaId) {
    const usuario = await criarUsuario({ perfil: 'professor', escolaId });
    const cargo = await Professor.create({
        idUsuario: String(usuario._id),
        nome: usuario.nome,
        email: usuario.email,
        vinculos: [{ escolaId, cargo: 'professor' }],
        salaPrincipal: '1A',
        ativo: true,
    });
    await Turma.create({ escolaId, nome: '1A', id: '1A' });
    return { usuario, cargo, cookie: cookieDe(usuario) };
}

async function diretorDa(escolaId) {
    const usuario = await criarUsuario({ perfil: 'diretor', escolaId });
    await Diretor.create({
        idUsuario: String(usuario._id),
        nome: usuario.nome,
        email: usuario.email,
        vinculos: [{ escolaId, cargo: 'diretor' }],
    });
    return cookieDe(usuario);
}

async function familia(escolaId, { turma = '1A', ra } = {}) {
    const email = `fam.${Math.random().toString(36).slice(2)}@escola.test`;
    const resp = await criarUsuario({ perfil: 'responsavel', email, escolaId });
    const aluno = await Aluno.create({
        nome: 'Filho',
        turma,
        ativo: true,
        escolaId,
        ...(ra ? { matricula: ra } : {}),
        responsavel: email,
    });
    return { aluno, cookie: cookieDe(resp) };
}

const notaDoCorpo = (extra) => ({ materiaId: 'Matemática', bimestre: 1, nota: 0, ...extra });

describe('nota avulsa (POST/PUT /api/notas)', () => {
    it('professor não grava nota em aluno de outra turma da mesma escola', async () => {
        const prof = await professorDa1A(A);
        const outraTurma = await familia(A, { turma: '2B' });

        const res = await request(app)
            .post('/api/notas')
            .set('Cookie', prof.cookie)
            .send(notaDoCorpo({ alunoId: String(outraTurma.aluno._id) }));

        expect(res.status).toBe(403);
        expect(await Nota.countDocuments()).toBe(0);
    });

    it('a matrícula gravada é a do aluno, não a do corpo', async () => {
        const prof = await professorDa1A(A);
        const meu = await familia(A, { ra: 'RA-A-1' });
        const daB = await familia(B, { ra: 'RA-B-777' });

        const res = await request(app)
            .post('/api/notas')
            .set('Cookie', prof.cookie)
            .send(notaDoCorpo({ alunoId: String(meu.aluno._id), matriculaId: 'RA-B-777' }));

        expect(res.status).toBe(201);
        expect(res.body.data.matriculaId).toBe('RA-A-1');
        const portalB = await request(app)
            .get(`/api/responsavel/notas/${daB.aluno._id}`)
            .set('Cookie', daB.cookie);
        expect(portalB.body.data).toEqual([]);
    });

    it('professor não grava nota só pelo RA de aluno de outra escola', async () => {
        const prof = await professorDa1A(A);
        await familia(B, { ra: 'RA-B-777' });

        const res = await request(app)
            .post('/api/notas')
            .set('Cookie', prof.cookie)
            .send(notaDoCorpo({ matriculaId: 'RA-B-777' }));

        expect(res.status).toBe(403);
        expect(await Nota.countDocuments()).toBe(0);
    });

    it('direção não grava nota em aluno de outra escola', async () => {
        const cookie = await diretorDa(A);
        const daB = await familia(B);

        const res = await request(app)
            .post('/api/notas')
            .set('Cookie', cookie)
            .send(notaDoCorpo({ alunoId: String(daB.aluno._id) }));

        expect(res.status).toBe(403);
        expect(await Nota.countDocuments()).toBe(0);
    });

    it('direção grava pelo RA de aluno da própria escola, com o aluno preenchido', async () => {
        const cookie = await diretorDa(A);
        const meu = await familia(A, { ra: 'RA-A-9' });

        const res = await request(app)
            .post('/api/notas')
            .set('Cookie', cookie)
            .send(notaDoCorpo({ matriculaId: 'RA-A-9' }));

        expect(res.status).toBe(201);
        expect(res.body.data.alunoId).toBe(String(meu.aluno._id));
    });

    it('direção não muda a nota para um aluno de outra escola', async () => {
        const cookie = await diretorDa(A);
        const meu = await familia(A);
        const daB = await familia(B);
        const nota = await Nota.create({
            escolaId: A,
            alunoId: String(meu.aluno._id),
            materiaId: 'Matemática',
            bimestre: 1,
            nota: 7,
        });

        const res = await request(app)
            .put(`/api/notas/${nota._id}`)
            .set('Cookie', cookie)
            .send({ alunoId: String(daB.aluno._id) });

        expect(res.status).toBe(403);
        expect((await Nota.findById(nota._id).lean()).alunoId).toBe(String(meu.aluno._id));
    });
});

describe('notas por avaliação (POST /api/avaliacoes-escolares/:id/notas)', () => {
    async function avaliacaoDa1A(prof) {
        return Avaliacao.create({
            escolaId: A,
            titulo: 'Prova',
            turmaId: '1A',
            materiaId: 'Ciências',
            bimestre: 2,
            professorId: String(prof.usuario._id),
        });
    }

    it('aluno de outra escola na lista: nada é gravado', async () => {
        const prof = await professorDa1A(A);
        const meu = await familia(A);
        const daB = await familia(B);
        const avaliacao = await avaliacaoDa1A(prof);

        const res = await request(app)
            .post(`/api/avaliacoes-escolares/${avaliacao._id}/notas`)
            .set('Cookie', prof.cookie)
            .send({
                notas: [
                    { alunoId: String(meu.aluno._id), nota: 8 },
                    { alunoId: String(daB.aluno._id), nota: 1 },
                ],
            });

        expect(res.status).toBe(400);
        expect(await Nota.countDocuments()).toBe(0);
    });

    it('aluno de outra turma da mesma escola na lista: nada é gravado', async () => {
        const prof = await professorDa1A(A);
        const outraTurma = await familia(A, { turma: '3C' });
        const avaliacao = await avaliacaoDa1A(prof);

        const res = await request(app)
            .post(`/api/avaliacoes-escolares/${avaliacao._id}/notas`)
            .set('Cookie', prof.cookie)
            .send({ notas: [{ alunoId: String(outraTurma.aluno._id), nota: 1 }] });

        expect(res.status).toBe(400);
        expect(await Nota.countDocuments()).toBe(0);
    });

    it('alunos da turma, inclusive com a turma grafada "1ºA", continuam lançando', async () => {
        const prof = await professorDa1A(A);
        const meu = await familia(A, { turma: '1ºA' });
        const avaliacao = await avaliacaoDa1A(prof);

        const res = await request(app)
            .post(`/api/avaliacoes-escolares/${avaliacao._id}/notas`)
            .set('Cookie', prof.cookie)
            .send({ notas: [{ alunoId: String(meu.aluno._id), nota: 8 }] });

        expect(res.status).toBe(200);
        expect(await Nota.countDocuments({ alunoId: String(meu.aluno._id) })).toBe(1);
    });
});

describe('falta avulsa (POST /api/faltas)', () => {
    it('professor não registra falta pelo RA de aluno de outra escola', async () => {
        const prof = await professorDa1A(A);
        await familia(B, { ra: 'RA-B-888' });

        const res = await request(app)
            .post('/api/faltas')
            .set('Cookie', prof.cookie)
            .send({
                professorId: String(prof.cargo._id),
                turma: '1A',
                matriculaId: 'RA-B-888',
                presente: false,
                materia: 'Sala Principal',
                data: '2026-03-10',
            });

        expect(res.status).toBe(403);
        expect(await Falta.countDocuments()).toBe(0);
    });

    it('com o aluno, a matrícula gravada é a do cadastro', async () => {
        const prof = await professorDa1A(A);
        const meu = await familia(A, { ra: 'RA-A-5' });

        const res = await request(app)
            .post('/api/faltas')
            .set('Cookie', prof.cookie)
            .send({
                professorId: String(prof.cargo._id),
                turma: '1A',
                aluno: String(meu.aluno._id),
                matriculaId: 'RA-B-888',
                presente: false,
                materia: 'Sala Principal',
                data: '2026-03-10',
            });

        expect(res.status).toBe(201);
        expect(res.body.data.matriculaId).toBe('RA-A-5');
    });
});

describe('portal da família', () => {
    it('nota de mesma matrícula em outra escola não aparece', async () => {
        const daB = await familia(B, { ra: 'RA-123' });
        // Matrícula não é única entre escolas: outra criança, na escola A.
        await Nota.create({
            escolaId: A,
            alunoId: 'outra-crianca',
            matriculaId: 'RA-123',
            materiaId: 'Matemática',
            bimestre: 1,
            nota: 2,
        });

        const res = await request(app)
            .get(`/api/responsavel/notas/${daB.aluno._id}`)
            .set('Cookie', daB.cookie);

        expect(res.status).toBe(200);
        expect(res.body.data).toEqual([]);
    });
});
