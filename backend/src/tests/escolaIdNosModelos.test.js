/**
 * escolaIdNosModelos.test.js — o campo que faltava nos oito modelos (Issue #229).
 *
 * O DEFEITO QUE ESTES TESTES GUARDAM É SILENCIOSO
 * ==============================================
 * Com `strict: true`, o Mongoose DESCARTA um campo que não está no schema. Não
 * lança, não avisa: o controller escrevia `escolaId`, o Mongoose jogava fora, e
 * o documento nascia órfão. Era por isso que os comentários de produção estavam
 * todos sem tenant mesmo com a rota montada atrás do `filtrarPorEscola`.
 *
 * O primeiro bloco testa o schema porque é ele que estava errado — um teste de
 * controller passaria por acidente enquanto o campo continuasse sendo jogado
 * fora, já que ninguém relê o documento para conferir.
 */
const mongoose = require('mongoose');

const { conectarBanco, limparBanco, desconectarBanco } = require('./helpers');

const GradeHoraria = require('../models/GradeHoraria');
const Comentario = require('../models/Comentario');
const FrequenciaProfessor = require('../models/FrequenciaProfessor');
const Especial = require('../models/Especial');
const ChatMensagem = require('../models/ChatMensagem');
const Badge = require('../models/Badge');
const RealtimeNotification = require('../models/RealtimeNotification');
const TabelaGeral = require('../models/TabelaGeral');

const ESCOLA_A = new mongoose.Types.ObjectId().toString();
const ESCOLA_B = new mongoose.Types.ObjectId().toString();

const MODELOS = [
    ['GradeHoraria', GradeHoraria],
    ['Comentario', Comentario],
    ['FrequenciaProfessor', FrequenciaProfessor],
    ['Especial', Especial],
    ['ChatMensagem', ChatMensagem],
    ['Badge', Badge],
    ['RealtimeNotification', RealtimeNotification],
    ['TabelaGeral', TabelaGeral],
];

beforeAll(async () => {
    await conectarBanco();
});
afterEach(async () => {
    await limparBanco();
});
afterAll(async () => {
    await desconectarBanco();
});

describe('os oito modelos declaram escolaId', () => {
    test.each(MODELOS)('%s tem o caminho escolaId no schema', (_nome, Modelo) => {
        const caminho = Modelo.schema.path('escolaId');
        expect(caminho).toBeDefined();
        expect(caminho.instance).toBe('String');
    });

    test.each(MODELOS)('%s indexa escolaId', (_nome, Modelo) => {
        // Sem índice, toda consulta escopada vira varredura de coleção — e o
        // escopo é aplicado em QUASE TODA consulta do sistema.
        const caminho = Modelo.schema.path('escolaId');
        expect(caminho.options.index).toBe(true);
    });
});

describe('o valor sobrevive à gravação — era isso que o strict descartava', () => {
    test('GradeHoraria guarda o escolaId de verdade', async () => {
        const criada = await GradeHoraria.create({
            professorId: 'prof-1',
            turmaId: '1A',
            disciplina: 'Matemática',
            diaSemana: 1,
            horaInicio: '07:30',
            horaFim: '08:20',
            escolaId: ESCOLA_A,
        });

        // Relê do banco: o `create` devolve o objeto em memória, que teria o
        // campo mesmo se o Mongoose o tivesse descartado na escrita.
        const doBanco = await GradeHoraria.findById(criada._id).lean();
        expect(doBanco.escolaId).toBe(ESCOLA_A);
    });

    test('Comentario guarda o escolaId de verdade', async () => {
        const criado = await Comentario.create({
            usuarioId: new mongoose.Types.ObjectId(),
            usuarioNome: 'Fulana',
            texto: 'oi',
            escolaId: ESCOLA_A,
        });

        const doBanco = await Comentario.findById(criado._id).lean();
        expect(doBanco.escolaId).toBe(ESCOLA_A);
    });

    test('ChatMensagem guarda o escolaId de verdade', async () => {
        const criada = await ChatMensagem.create({
            usuarioId: 'u1',
            usuarioPerfil: 'professor',
            pergunta: 'quantos alunos?',
            resposta: '57',
            escolaId: ESCOLA_A,
        });

        const doBanco = await ChatMensagem.findById(criada._id).lean();
        expect(doBanco.escolaId).toBe(ESCOLA_A);
    });
});

describe('a consulta escopada separa as escolas', () => {
    test('grade da escola A não aparece na consulta da escola B', async () => {
        const base = {
            professorId: 'prof-1',
            turmaId: '1A',
            disciplina: 'Matemática',
            diaSemana: 1,
            horaInicio: '07:30',
            horaFim: '08:20',
        };

        await GradeHoraria.create({ ...base, escolaId: ESCOLA_A });
        await GradeHoraria.create({ ...base, escolaId: ESCOLA_B });

        const daA = await GradeHoraria.find({ escolaId: ESCOLA_A }).lean();
        const daB = await GradeHoraria.find({ escolaId: ESCOLA_B }).lean();

        expect(daA).toHaveLength(1);
        expect(daB).toHaveLength(1);
        expect(daA[0].escolaId).toBe(ESCOLA_A);
        expect(daB[0].escolaId).toBe(ESCOLA_B);
    });

    test('comentário da escola A não vaza para a consulta da escola B', async () => {
        await Comentario.create({
            usuarioId: new mongoose.Types.ObjectId(),
            usuarioNome: 'Da A',
            texto: 'comentário da escola A',
            escolaId: ESCOLA_A,
        });

        const daB = await Comentario.find({ escolaId: ESCOLA_B }).lean();
        expect(daB).toHaveLength(0);
    });

    test('documento legado sem escolaId não aparece em consulta escopada', async () => {
        // Comportamento DESEJADO e igual ao do resto do sistema: registro
        // pré-multi-escola fica de fora até ser migrado. O teste existe para
        // que a mudança seja uma decisão registrada, não uma surpresa.
        await Comentario.collection.insertOne({
            usuarioNome: 'Legado',
            texto: 'sem tenant',
        });

        const daA = await Comentario.find({ escolaId: ESCOLA_A }).lean();
        expect(daA).toHaveLength(0);

        const todos = await Comentario.find({}).lean();
        expect(todos).toHaveLength(1);
    });
});
