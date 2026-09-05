/**
 * criarJustificativa.test.js — a rota que faltava (Issue #224).
 *
 * O teste que mais importa aqui não é o do caminho feliz: é o do EFEITO. Sem
 * criação, o `justificada = true` do fluxo de análise nunca rodava, e a
 * distinção entre falta justificada e injustificada — que a planilha exibe e a
 * contagem de presença usa — não existia na prática.
 */
const mongoose = require('mongoose');

const { conectarBanco, limparBanco, desconectarBanco } = require('./helpers');
const SecretariaController = require('../controllers/SecretariaController');
const JustificativaFalta = require('../models/JustificativaFalta');
const Aluno = require('../models/Aluno');
const Falta = require('../models/Falta');

const ESCOLA_A = new mongoose.Types.ObjectId().toString();
const ESCOLA_B = new mongoose.Types.ObjectId().toString();

function fakeRes() {
    return {
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
}

const reqDe = (escolaId, body) => ({
    escolaId,
    user: { _id: 'user-sec', id: 'user-sec', nome: 'Secretaria', perfil: 'secretaria' },
    body,
    ip: '127.0.0.1',
    get: () => 'jest',
});

async function criarAluno(escolaId, nome = 'Ana', sobrenome = 'Souza') {
    return Aluno.create({ nome, sobrenome, escolaId, turma: '1A' });
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

describe('criarJustificativa — a coleção deixa de ser inalcançável', () => {
    test('grava a justificativa e devolve 201', async () => {
        const aluno = await criarAluno(ESCOLA_A);
        const res = fakeRes();

        await SecretariaController.criarJustificativa(
            reqDe(ESCOLA_A, {
                alunoId: String(aluno._id),
                dataInicio: '2026-03-02',
                dataFim: '2026-03-04',
                motivo: 'Consulta médica',
                categoria: 'saude',
                origemEnvio: 'presencial',
            }),
            res
        );

        expect(res.statusCode).toBe(201);
        expect(res.payload.success).toBe(true);

        const gravada = await JustificativaFalta.findOne({ alunoId: String(aluno._id) }).lean();
        expect(gravada).not.toBeNull();
        expect(gravada.status).toBe('pendente');
        expect(gravada.alunoNome).toBe('Ana Souza');
        expect(gravada.escolaId).toBe(ESCOLA_A);
    });

    test('preenche os campos do lado de ENVIO, que eram todos mortos', async () => {
        const aluno = await criarAluno(ESCOLA_A);
        const res = fakeRes();

        await SecretariaController.criarJustificativa(
            reqDe(ESCOLA_A, {
                alunoId: String(aluno._id),
                dataInicio: '2026-03-02',
                motivo: 'Atestado',
                origemEnvio: 'presencial',
            }),
            res
        );

        const g = await JustificativaFalta.findOne({}).lean();
        expect(g.enviadoPor).toBe('user-sec');
        expect(g.enviadoPorNome).toBe('Secretaria');
        expect(g.origemEnvio).toBe('presencial');
    });

    test('origemEnvio fora do enum cai no padrão em vez de ser aceito', async () => {
        const aluno = await criarAluno(ESCOLA_A);
        const res = fakeRes();

        await SecretariaController.criarJustificativa(
            reqDe(ESCOLA_A, {
                alunoId: String(aluno._id),
                dataInicio: '2026-03-02',
                motivo: 'Atestado',
                // Confiar nisso falsificaria a procedência do documento.
                origemEnvio: 'inventado_pelo_cliente',
            }),
            res
        );

        const g = await JustificativaFalta.findOne({}).lean();
        expect(g.origemEnvio).toBe('secretaria');
    });

    test('sem dataFim, o período é de um dia só', async () => {
        const aluno = await criarAluno(ESCOLA_A);
        const res = fakeRes();

        await SecretariaController.criarJustificativa(
            reqDe(ESCOLA_A, {
                alunoId: String(aluno._id),
                dataInicio: '2026-03-02',
                motivo: 'Consulta',
            }),
            res
        );

        const g = await JustificativaFalta.findOne({}).lean();
        expect(g.dataFim.getTime()).toBe(g.dataInicio.getTime());
    });
});

describe('criarJustificativa — recusas', () => {
    test.each([
        ['sem aluno', { dataInicio: '2026-03-02', motivo: 'x' }],
        ['sem data', { alunoId: 'qualquer', motivo: 'x' }],
        ['sem motivo', { alunoId: 'qualquer', dataInicio: '2026-03-02' }],
    ])('recusa %s com 400', async (_rotulo, body) => {
        const res = fakeRes();
        await SecretariaController.criarJustificativa(reqDe(ESCOLA_A, body), res);
        expect(res.statusCode).toBe(400);
    });

    test('recusa dataFim anterior a dataInicio', async () => {
        const aluno = await criarAluno(ESCOLA_A);
        const res = fakeRes();

        await SecretariaController.criarJustificativa(
            reqDe(ESCOLA_A, {
                alunoId: String(aluno._id),
                dataInicio: '2026-03-10',
                dataFim: '2026-03-02',
                motivo: 'x',
            }),
            res
        );

        expect(res.statusCode).toBe(400);
        expect(await JustificativaFalta.countDocuments({})).toBe(0);
    });

    test('recusa data inválida', async () => {
        const aluno = await criarAluno(ESCOLA_A);
        const res = fakeRes();

        await SecretariaController.criarJustificativa(
            reqDe(ESCOLA_A, {
                alunoId: String(aluno._id),
                dataInicio: 'trinta de fevereiro',
                motivo: 'x',
            }),
            res
        );

        expect(res.statusCode).toBe(400);
    });

    test('NÃO justifica falta de aluno de outra escola', async () => {
        const alunoDaB = await criarAluno(ESCOLA_B, 'Bruno', 'Lima');
        const res = fakeRes();

        // A secretaria da escola A tenta usar o id de um aluno da B.
        await SecretariaController.criarJustificativa(
            reqDe(ESCOLA_A, {
                alunoId: String(alunoDaB._id),
                dataInicio: '2026-03-02',
                motivo: 'x',
            }),
            res
        );

        expect(res.statusCode).toBe(404);
        expect(await JustificativaFalta.countDocuments({})).toBe(0);
    });
});

describe('o efeito que dependia da criação', () => {
    test('aprovar marca as faltas do período como justificadas', async () => {
        const aluno = await criarAluno(ESCOLA_A);

        // Uma falta dentro do período e outra fora — só a de dentro muda.
        await Falta.create({
            aluno: String(aluno._id),
            turma: '1A',
            materia: 'Sala Principal',
            data: new Date('2026-03-03'),
            presente: false,
            justificada: false,
            escolaId: ESCOLA_A,
        });
        await Falta.create({
            aluno: String(aluno._id),
            turma: '1A',
            materia: 'Sala Principal',
            data: new Date('2026-03-20'),
            presente: false,
            justificada: false,
            escolaId: ESCOLA_A,
        });

        const criar = fakeRes();
        await SecretariaController.criarJustificativa(
            reqDe(ESCOLA_A, {
                alunoId: String(aluno._id),
                dataInicio: '2026-03-02',
                dataFim: '2026-03-04',
                motivo: 'Consulta médica',
            }),
            criar
        );

        const id = String(criar.payload.data._id);

        const analisar = fakeRes();
        await SecretariaController.analisarJustificativa(
            {
                ...reqDe(ESCOLA_A, { status: 'aprovada' }),
                params: { id },
            },
            analisar
        );

        expect(analisar.payload.success).toBe(true);

        const dentro = await Falta.findOne({ data: new Date('2026-03-03') }).lean();
        const fora = await Falta.findOne({ data: new Date('2026-03-20') }).lean();

        // Este é o efeito que NUNCA rodou antes desta rota existir.
        expect(dentro.justificada).toBe(true);
        expect(dentro.motivo).toBe('Consulta médica');
        expect(fora.justificada).toBe(false);
    });
});
