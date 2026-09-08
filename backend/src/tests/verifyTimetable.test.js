/**
 * verifyTimetable.test.js — a barreira de horário da chamada (Issue #207).
 *
 * O que estes testes protegem é a DISTINÇÃO que faltava no middleware: negar a
 * aula fora da grade é o controle funcionando; negar quem não tem grade nenhuma
 * é o sistema fora do ar. Produção tinha 3 faltas gravadas no ano inteiro por
 * causa da segunda leitura.
 *
 * Cobre também os dois defeitos de busca que faziam a chamada da turma inteira
 * se perder: comparação de nome byte a byte e ausência de escopo de escola.
 */
const mongoose = require('mongoose');

const { conectarBanco, limparBanco, desconectarBanco } = require('./helpers');
const verifyTimetable = require('../middleware/verifyTimetable');
const Professor = require('../models/Professor');
const Turma = require('../models/Turma');
const GradeHoraria = require('../models/GradeHoraria');

const ESCOLA_A = new mongoose.Types.ObjectId().toString();
const ESCOLA_B = new mongoose.Types.ObjectId().toString();

/** Executa o middleware e devolve o que ele decidiu, sem servidor HTTP. */
async function rodar(body, escolaId = ESCOLA_A) {
    const req = { body, escolaId, user: { perfil: 'professor' } };

    let statusCode = 200;
    let payload = null;
    let passou = false;

    const res = {
        status(codigo) {
            statusCode = codigo;
            return this;
        },
        json(corpo) {
            payload = corpo;
            return this;
        },
    };

    await verifyTimetable(req, res, () => {
        passou = true;
    });

    return { passou, statusCode, payload, req };
}

async function criarProfessor(nome, escolaId = ESCOLA_A) {
    return Professor.create({
        nome,
        vinculos: [{ escolaId, cargo: 'professor' }],
        ativo: true,
    });
}

beforeAll(async () => {
    await conectarBanco();
});
afterEach(async () => {
    await limparBanco();
});
afterAll(async () => {
    await desconectarBanco();
});

describe('verifyTimetable — grade ausente x aula fora da grade', () => {
    test('professor SEM nenhuma grade cadastrada consegue lançar a chamada', async () => {
        await criarProfessor('Gisleide Nóbrega');
        await Turma.create({ _id: '5A', nome: '5A', escolaId: ESCOLA_A });

        const r = await rodar({
            nomeProfessor: 'Gisleide Nóbrega',
            turma: '5A',
            data: '2026-03-10',
        });

        expect(r.passou).toBe(true);
        // A requisição carrega a marca de que passou sem grade — é o que permite
        // medir quantas escolas operam sem o horário preenchido.
        expect(r.req.gradeAusente).toBe(true);
        expect(r.req.gradeHoraria).toBeNull();
    });

    test('professor COM grade continua barrado ao lançar fora dela', async () => {
        const prof = await criarProfessor('Raquel Martins');
        await Turma.create({ _id: '5A', nome: '5A', escolaId: ESCOLA_A });
        await Turma.create({ _id: '5B', nome: '5B', escolaId: ESCOLA_A });

        // Tem aula com a 5A na segunda-feira — e só.
        await GradeHoraria.create({
            professorId: String(prof._id),
            turmaId: '5A',
            disciplina: 'Matemática',
            diaSemana: 1,
            horaInicio: '07:30',
            horaFim: '08:20',
            ativo: true,
            escolaId: ESCOLA_A,
        });

        // 2026-03-10 é uma terça-feira: dia sem aula com esta turma.
        const r = await rodar({
            nomeProfessor: 'Raquel Martins',
            turma: '5B',
            data: '2026-03-10',
        });

        expect(r.passou).toBe(false);
        expect(r.statusCode).toBe(403);
        expect(r.payload.code).toBe('FORA_DA_GRADE');
    });

    test('professor COM grade passa no dia em que tem aula com a turma', async () => {
        const prof = await criarProfessor('Raquel Martins');
        await Turma.create({ _id: '5A', nome: '5A', escolaId: ESCOLA_A });

        await GradeHoraria.create({
            professorId: String(prof._id),
            turmaId: '5A',
            disciplina: 'Matemática',
            diaSemana: 2, // terça
            horaInicio: '07:30',
            horaFim: '08:20',
            ativo: true,
            escolaId: ESCOLA_A,
        });

        // 2026-03-10 cai numa terça-feira.
        const r = await rodar({
            nomeProfessor: 'Raquel Martins',
            turma: '5A',
            data: '2026-03-10',
        });

        expect(r.passou).toBe(true);
        expect(r.req.gradeAusente).toBeUndefined();
    });
});

describe('verifyTimetable — busca do professor', () => {
    test.each([
        ['caixa alta e espaço no fim', 'GISLEIDE NÓBREGA '],
        ['sem acento', 'Gisleide Nobrega'],
        ['espaços repetidos', 'Gisleide   Nóbrega'],
    ])('encontra o cadastro com %s', async (_rotulo, comoVeioDoFront) => {
        await criarProfessor('Gisleide Nóbrega');
        await Turma.create({ _id: '5A', nome: '5A', escolaId: ESCOLA_A });

        const r = await rodar({
            nomeProfessor: comoVeioDoFront,
            turma: '5A',
            data: '2026-03-10',
        });

        // Sem grade cadastrada, passar é o comportamento esperado. O que este
        // teste prova é que NÃO caiu no 400 de "professor não encontrado".
        expect(r.passou).toBe(true);
        expect(r.payload).toBeNull();
    });

    test('nome que não existe devolve 400 com código próprio', async () => {
        await Turma.create({ _id: '5A', nome: '5A', escolaId: ESCOLA_A });

        const r = await rodar({
            nomeProfessor: 'Alguém Que Não Existe',
            turma: '5A',
            data: '2026-03-10',
        });

        expect(r.passou).toBe(false);
        expect(r.statusCode).toBe(400);
        expect(r.payload.code).toBe('PROFESSOR_NAO_ENCONTRADO');
    });

    test('homônima de outra escola NÃO é usada', async () => {
        // A "Maria Silva" cadastrada é da escola B. A requisição é da escola A.
        await criarProfessor('Maria Silva', ESCOLA_B);
        await Turma.create({ _id: '5A', nome: '5A', escolaId: ESCOLA_A });

        const r = await rodar(
            { nomeProfessor: 'Maria Silva', turma: '5A', data: '2026-03-10' },
            ESCOLA_A
        );

        // Antes, o findOne sem escopo devolvia a professora da outra unidade e a
        // grade consultada passava a ser a de lá.
        expect(r.passou).toBe(false);
        expect(r.payload.code).toBe('PROFESSOR_NAO_ENCONTRADO');
    });
});

describe('verifyTimetable — busca da turma', () => {
    test.each([
        ['com ordinal', '5ºA'],
        ['com espaço', '5 A'],
        ['em minúsculas', '5a'],
    ])('casa a turma cadastrada como "5A" quando o front manda %s', async (_r, comoVeio) => {
        await criarProfessor('Gisleide Nóbrega');
        await Turma.create({ _id: '5A', nome: '5A', escolaId: ESCOLA_A });

        const r = await rodar({
            nomeProfessor: 'Gisleide Nóbrega',
            turma: comoVeio,
            data: '2026-03-10',
        });

        expect(r.passou).toBe(true);
    });
});
