/**
 * syncIsolamentoEscola.test.js — os dois `deleteMany` que apagavam dados de
 * outras escolas (Issue #222).
 *
 * O que estes testes guardam não é o caminho feliz da sincronização: é o efeito
 * COLATERAL dela sobre a escola vizinha. Ambos os defeitos eram invisíveis
 * enquanto havia uma escola só, e nenhum deles emitia erro — a escola B
 * simplesmente perdia os dados quando a A salvava.
 */
const mongoose = require('mongoose');

const { conectarBanco, limparBanco, desconectarBanco } = require('./helpers');
const AttendanceController = require('../controllers/AttendanceController');
const TeacherAssignmentController = require('../controllers/TeacherAssignmentController');
const Falta = require('../models/Falta');
const AtribuicaoProfessor = require('../models/AtribuicaoProfessor');

const ESCOLA_A = new mongoose.Types.ObjectId().toString();
const ESCOLA_B = new mongoose.Types.ObjectId().toString();

/** Resposta falsa o bastante para os controllers, sem servidor HTTP. */
function fakeRes() {
    const res = {
        statusCode: 200,
        payload: null,
        status(c) {
            this.statusCode = c;
            return this;
        },
        json(b) {
            this.payload = b;
            return this;
        },
    };
    return res;
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

describe('AttendanceController.sync — a chamada de uma escola não apaga a da outra', () => {
    test('sincronizar a turma 1A da escola A preserva a 1A da escola B', async () => {
        // MESMA representação que o controller grava: ele faz `new Date('2026-03-10')`,
        // que é meia-noite UTC. Uma fixture em horário local cai FORA da janela do
        // delete e sobreviveria sozinha — o teste passaria sem provar o filtro.
        const data = new Date('2026-03-10');

        // As duas escolas têm uma turma "1A" com a mesma matéria no mesmo dia —
        // exatamente a colisão de chave que o filtro sem escolaId ignorava.
        await Falta.create({
            aluno: 'aluno-da-B',
            turma: '1A',
            materia: 'Sala Principal',
            data,
            presente: false,
            escolaId: ESCOLA_B,
        });

        const req = {
            escolaId: ESCOLA_A,
            user: { perfil: 'diretor', id: 'u1', nome: 'Diretora' },
            body: {
                turma: '1A',
                materia: 'Sala Principal',
                data: '2026-03-10',
                presencas: [{ alunoId: 'aluno-da-A', presente: true }],
            },
        };

        const res = fakeRes();
        await AttendanceController.sync(req, res);

        expect(res.payload.success).toBe(true);

        // A falta da escola B continua lá.
        const daB = await Falta.find({ escolaId: ESCOLA_B }).lean();
        expect(daB).toHaveLength(1);
        expect(daB[0].aluno).toBe('aluno-da-B');

        // E a da escola A foi gravada.
        const daA = await Falta.find({ escolaId: ESCOLA_A }).lean();
        expect(daA).toHaveLength(1);
        expect(daA[0].aluno).toBe('aluno-da-A');
    });

    test('a própria escola continua substituindo o que já havia no dia', async () => {
        // MESMA representação que o controller grava: ele faz `new Date('2026-03-10')`,
        // que é meia-noite UTC. Uma fixture em horário local cai FORA da janela do
        // delete e sobreviveria sozinha — o teste passaria sem provar o filtro.
        const data = new Date('2026-03-10');

        await Falta.create({
            aluno: 'aluno-1',
            turma: '1A',
            materia: 'Sala Principal',
            data,
            presente: false,
            escolaId: ESCOLA_A,
        });

        const res = fakeRes();
        await AttendanceController.sync(
            {
                escolaId: ESCOLA_A,
                user: { perfil: 'diretor', id: 'u1', nome: 'Diretora' },
                body: {
                    turma: '1A',
                    materia: 'Sala Principal',
                    data: '2026-03-10',
                    presencas: [{ alunoId: 'aluno-1', presente: true }],
                },
            },
            res
        );

        // Uma linha só, com o valor novo: refazer a chamada corrige, não duplica.
        const daA = await Falta.find({ escolaId: ESCOLA_A }).lean();
        expect(daA).toHaveLength(1);
        expect(daA[0].presente).toBe(true);
    });

    test('registro legado sem escolaId é substituído pela escola que grava', async () => {
        // MESMA representação que o controller grava: ele faz `new Date('2026-03-10')`,
        // que é meia-noite UTC. Uma fixture em horário local cai FORA da janela do
        // delete e sobreviveria sozinha — o teste passaria sem provar o filtro.
        const data = new Date('2026-03-10');

        // Gravado antes do multi-escola: sem tenant nenhum.
        await Falta.collection.insertOne({
            _id: 'legado-1',
            aluno: 'aluno-1',
            turma: '1A',
            materia: 'Sala Principal',
            data,
            presente: false,
        });

        const res = fakeRes();
        await AttendanceController.sync(
            {
                escolaId: ESCOLA_A,
                user: { perfil: 'diretor', id: 'u1', nome: 'Diretora' },
                body: {
                    turma: '1A',
                    materia: 'Sala Principal',
                    data: '2026-03-10',
                    presencas: [{ alunoId: 'aluno-1', presente: true }],
                },
            },
            res
        );

        // O legado some (era o que a nova gravação vem substituir) e não fica
        // órfão para sempre ao lado do registro novo.
        const total = await Falta.countDocuments({});
        expect(total).toBe(1);
        const restante = await Falta.findOne({}).lean();
        expect(restante.escolaId).toBe(ESCOLA_A);
    });

    test('a falta gravada carrega justificada = false explicitamente', async () => {
        const res = fakeRes();
        await AttendanceController.sync(
            {
                escolaId: ESCOLA_A,
                user: { perfil: 'diretor', id: 'u1', nome: 'Diretora' },
                body: {
                    turma: '1A',
                    materia: 'Sala Principal',
                    data: '2026-03-10',
                    presencas: [{ alunoId: 'aluno-1', presente: false }],
                },
            },
            res
        );

        // `undefined` fazia a consulta `{ justificada: false }` do relatório de
        // frequência não casar com nenhuma falta gravada.
        const f = await Falta.findOne({ escolaId: ESCOLA_A }).lean();
        expect(f.justificada).toBe(false);
    });
});

describe('TeacherAssignmentController.sync — salvar numa escola não zera as outras', () => {
    test('sincronizar as atribuições da escola A preserva as da escola B', async () => {
        await AtribuicaoProfessor.create({
            nome: 'Professora da B',
            classe: 'PEB I',
            escolaId: ESCOLA_B,
        });

        const res = fakeRes();
        await TeacherAssignmentController.sync(
            {
                escolaId: ESCOLA_A,
                user: { perfil: 'diretor', id: 'u1', nome: 'Diretora' },
                // A tela só carrega as da escola atual, então a lista enviada
                // NUNCA contém as das outras. Era isso que as apagava.
                body: { atribuicoes: [{ nome: 'Professora da A', classe: 'PEB II' }] },
            },
            res
        );

        const daB = await AtribuicaoProfessor.find({ escolaId: ESCOLA_B }).lean();
        expect(daB).toHaveLength(1);
        expect(daB[0].nome).toBe('Professora da B');

        const daA = await AtribuicaoProfessor.find({ escolaId: ESCOLA_A }).lean();
        expect(daA).toHaveLength(1);
        expect(daA[0].nome).toBe('Professora da A');
    });

    test('a atribuição criada carrega o escolaId da requisição', async () => {
        const res = fakeRes();
        await TeacherAssignmentController.sync(
            {
                escolaId: ESCOLA_A,
                user: { perfil: 'diretor', id: 'u1', nome: 'Diretora' },
                body: { atribuicoes: [{ nome: 'Nova Professora', classe: 'PEB I' }] },
            },
            res
        );

        const criada = await AtribuicaoProfessor.findOne({ nome: 'Nova Professora' }).lean();
        expect(criada.escolaId).toBe(ESCOLA_A);
    });

    test('a listagem devolve só as atribuições da escola da requisição', async () => {
        await AtribuicaoProfessor.create({ nome: 'Da A', classe: 'x', escolaId: ESCOLA_A });
        await AtribuicaoProfessor.create({ nome: 'Da B', classe: 'y', escolaId: ESCOLA_B });

        const res = fakeRes();
        await TeacherAssignmentController.sync(
            {
                escolaId: ESCOLA_A,
                user: { perfil: 'diretor', id: 'u1', nome: 'Diretora' },
                body: { atribuicoes: [{ nome: 'Da A', classe: 'x' }] },
            },
            res
        );

        const nomes = (res.payload.data || []).map((a) => a.nome);
        expect(nomes).toContain('Da A');
        expect(nomes).not.toContain('Da B');
    });
});
