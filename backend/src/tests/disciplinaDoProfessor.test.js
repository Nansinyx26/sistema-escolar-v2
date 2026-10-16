/**
 * disciplinaDoProfessor.test.js — Issue #759
 *
 * A criação de avaliação já conferia a disciplina do professor; a chamada, a
 * nota e o lançamento conferiam só a turma. O especialista de Ed. Física da 1A
 * reescrevia a chamada e a nota de Matemática do regente, o `verifyTimetable`
 * acreditava no professor do corpo, um sync recusado já tinha apagado a
 * chamada e o professor gravava falta já justificada.
 */
const request = require('supertest');
const app = require('../app');
const Escola = require('../models/Escola');
const Professor = require('../models/Professor');
const Aluno = require('../models/Aluno');
const Turma = require('../models/Turma');
const Falta = require('../models/Falta');
const Nota = require('../models/Nota');
const GradeHoraria = require('../models/GradeHoraria');
const { assinarTokenSessao } = require('../utils/sessionToken');
const { invalidarCacheEscolas } = require('../middleware/filtrarPorEscola');
const { conectarBanco, limparBanco, desconectarBanco, criarUsuario } = require('./helpers');

const cookieDe = (u) => [`escola_jwt=${assinarTokenSessao(u)}`];
const SEGUNDA = '2026-05-04';

let escolaId;
let aluno;
let outro;
let regente;
let edf;

beforeAll(async () => {
    await conectarBanco();
});
afterAll(async () => {
    await desconectarBanco();
});

async function professor(nome, extra) {
    const user = await criarUsuario({
        perfil: 'professor',
        nome,
        email: `${nome.replace(/\W/g, '').toLowerCase()}@escola.test`,
        escolaId,
    });
    const doc = await Professor.create({
        idUsuario: String(user._id),
        nome,
        email: user.email,
        ativo: true,
        vinculos: [{ escolaId, cargo: 'professor' }],
        ...extra,
    });
    return { user, doc };
}

beforeEach(async () => {
    await limparBanco();
    escolaId = String((await Escola.create({ nome: 'EMEF 759', tipo: 'EMEF', ativo: true }))._id);
    invalidarCacheEscolas();
    await Turma.create({ id: '1A', nome: '1A', escolaId });
    await Turma.create({ id: '2B', nome: '2B', escolaId });
    aluno = await Aluno.create({
        nome: 'Aluno 1A',
        turma: '1A',
        turmaId: '1A',
        escolaId,
        ativo: true,
    });
    outro = await Aluno.create({
        nome: 'Aluno 2B',
        turma: '2B',
        turmaId: '2B',
        escolaId,
        ativo: true,
    });
    regente = await professor('Prof Regente', { turmas: ['1A'], salaPrincipal: '1A' });
    edf = await professor('Prof EdFisica', {
        materias: ['Ed. Física'],
        tipoEspecial: true,
        salaPrincipal: 'VARIADOS',
        salasAdicionais: ['1A'],
        turmas: ['1A'],
    });
    await GradeHoraria.create({
        escolaId,
        professorId: String(regente.doc._id),
        turmaId: '1A',
        diaSemana: 1,
        horaInicio: '07:00',
        horaFim: '08:00',
        materia: 'Matemática',
        ativo: true,
    }).catch(() => null);
    // Chamada da Sala Principal feita pelo regente: aluno PRESENTE.
    await Falta.create({
        escolaId,
        aluno: String(aluno._id),
        turma: '1A',
        data: new Date(`${SEGUNDA}T12:00:00`),
        materia: 'Sala Principal',
        presente: true,
        justificada: false,
    });
});

const sync = (quem, corpo) =>
    request(app)
        .post('/api/faltas/sync')
        .set('Cookie', cookieDe(quem.user))
        .send({ turma: '1A', data: SEGUNDA, ...corpo });

const chamadaDoRegente = () =>
    Falta.find({ materia: 'Sala Principal', aluno: String(aluno._id) }).lean();

describe('chamada', () => {
    it('o especialista não reescreve a chamada da Sala Principal, nem dizendo ser o regente', async () => {
        const res = await sync(edf, {
            materia: 'Sala Principal',
            nomeProfessor: 'Prof Regente',
            presencas: [{ alunoId: String(aluno._id), presente: false }],
        });

        expect(res.status).toBe(403);
        const chamada = await chamadaDoRegente();
        expect(chamada).toHaveLength(1);
        expect(chamada[0].presente).toBe(true);
    });

    it('sync recusado (aluno de outra turma) não apaga a chamada do dia', async () => {
        const res = await sync(regente, {
            materia: 'Sala Principal',
            presencas: [{ alunoId: String(outro._id), presente: false }],
        });

        expect(res.status).toBe(403);
        expect(await chamadaDoRegente()).toHaveLength(1);
    });

    it('cada um lança a chamada da própria disciplina (controle)', async () => {
        const doRegente = await sync(regente, {
            materia: 'Sala Principal',
            presencas: [{ alunoId: String(aluno._id), presente: false }],
        });
        const doEspecialista = await sync(edf, {
            materia: 'Educação Física',
            presencas: [{ alunoId: String(aluno._id), presente: true }],
        });

        expect(doRegente.status).toBe(200);
        expect(doEspecialista.status).toBe(200);
        expect((await chamadaDoRegente())[0].presente).toBe(false);
    });

    it('falta lançada pelo professor nasce sem justificativa', async () => {
        const res = await request(app)
            .post('/api/faltas')
            .set('Cookie', cookieDe(edf.user))
            .send({
                aluno: String(aluno._id),
                turma: '1A',
                data: SEGUNDA,
                materia: 'Educação Física',
                presente: false,
                justificada: true,
                motivo: 'atestado',
            });

        expect(res.status).toBe(201);
        expect(res.body.data.justificada).toBe(false);
        expect(res.body.data.motivo).toBeUndefined();
    });
});

describe('nota', () => {
    async function provaDeMatematica() {
        const criada = await request(app)
            .post('/api/avaliacoes-escolares')
            .set('Cookie', cookieDe(regente.user))
            .send({
                titulo: 'Prova Mat',
                turmaId: '1A',
                materiaId: 'Matemática',
                bimestre: 1,
                data: SEGUNDA,
                valor: 10,
            });
        expect(criada.status).toBe(201);
        const id = criada.body.data._id;
        await request(app)
            .post(`/api/avaliacoes-escolares/${id}/notas`)
            .set('Cookie', cookieDe(regente.user))
            .send({ notas: [{ alunoId: String(aluno._id), nota: 9 }] })
            .expect(200);
        return id;
    }

    it('o especialista não lança nota nem edita a avaliação de Matemática', async () => {
        const id = await provaDeMatematica();

        const lancar = await request(app)
            .post(`/api/avaliacoes-escolares/${id}/notas`)
            .set('Cookie', cookieDe(edf.user))
            .send({ notas: [{ alunoId: String(aluno._id), nota: 1 }], motivo: 'x' });
        const editar = await request(app)
            .put(`/api/avaliacoes-escolares/${id}`)
            .set('Cookie', cookieDe(edf.user))
            .send({ titulo: 'Alterada' });

        expect(lancar.status).toBe(403);
        expect(editar.status).toBe(403);
        const nota = await Nota.findOne({ avaliacaoId: String(id) }).lean();
        expect(nota.nota).toBe(9);
    });

    it('nem pela rota de notas: corrigir, apagar ou criar nota de Matemática', async () => {
        const id = await provaDeMatematica();
        const nota = await Nota.findOne({ avaliacaoId: String(id) }).lean();
        const comoEdf = (req) => req.set('Cookie', cookieDe(edf.user));

        const put = await comoEdf(request(app).put(`/api/notas/${nota._id}`)).send({ nota: 0.5 });
        const del = await comoEdf(request(app).delete(`/api/notas/${nota._id}`));
        const post = await comoEdf(request(app).post('/api/notas')).send({
            alunoId: String(aluno._id),
            materiaId: 'Matemática',
            bimestre: 1,
            nota: 0,
        });

        expect([put.status, del.status, post.status]).toEqual([403, 403, 403]);
        expect((await Nota.findById(nota._id).lean()).nota).toBe(9);
    });

    it('o especialista lança nota da própria disciplina (controle)', async () => {
        const res = await request(app)
            .post('/api/notas')
            .set('Cookie', cookieDe(edf.user))
            .send({
                alunoId: String(aluno._id),
                materiaId: 'Educação Física',
                bimestre: 1,
                nota: 8,
            });

        expect(res.status).toBe(201);
    });
});
