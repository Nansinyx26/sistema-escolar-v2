/**
 * pedagogicoController.offline.test.js
 *
 * Simula a falha do assistente (voiceService.generateInsightText rejeitando,
 * tanto por erro de rede quanto por quota excedida) e valida que as rotas
 * gerarPlanoAula / gerarPlanoEstudo / analisarTurma respondem 200 com
 * modoOffline: true + opcoesSugeridas, em vez de 500.
 */

// Mock do assistente ANTES de importar o controller.
jest.mock('../services/voiceService', () => ({
    generateInsightText: jest.fn(),
}));

// Mock da predição para isolar o teste do cálculo real.
jest.mock('../services/PedagogicoService', () => ({
    predictFinalGrade: jest.fn(),
}));

const voiceService = require('../services/voiceService');
const PedagogicoService = require('../services/PedagogicoService');
const PedagogicoController = require('../controllers/PedagogicoController');
const Aluno = require('../models/Aluno');
const { conectarBanco, limparBanco, desconectarBanco } = require('./helpers');

// Helper: cria um objeto `res` espião no padrão Express.
function mockRes() {
    const res = {};
    res.statusCode = 200;
    res.body = null;
    res.status = jest.fn((code) => { res.statusCode = code; return res; });
    res.json = jest.fn((payload) => { res.body = payload; return res; });
    return res;
}

beforeAll(async () => {
    await conectarBanco();
});

afterEach(async () => {
    await limparBanco();
    jest.clearAllMocks();
});

afterAll(async () => {
    await desconectarBanco();
});

describe('PedagogicoController — fallback offline (assistente indisponível)', () => {
    it('gerarPlanoAula retorna 200 + modoOffline quando o assistente falha (erro de rede)', async () => {
        voiceService.generateInsightText.mockRejectedValue(new Error('network error'));

        const req = { body: { tema: 'Frações', materia: 'Matemática', ano: '9º ano' } };
        const res = mockRes();

        await PedagogicoController.gerarPlanoAula(req, res);

        expect(res.statusCode).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data.modoOffline).toBe(true);
        expect(Array.isArray(res.body.data.opcoesSugeridas)).toBe(true);
        expect(res.body.data.opcoesSugeridas.length).toBeGreaterThanOrEqual(2);
        expect(typeof res.body.data.planoHtml).toBe('string');
        expect(res.body.data.planoHtml.toLowerCase()).not.toContain('gemini');
    });

    it('gerarPlanoAula retorna 200 + modoOffline quando a quota é excedida', async () => {
        const quotaErr = new Error('quota exceeded');
        quotaErr.quotaExceeded = true;
        voiceService.generateInsightText.mockRejectedValue(quotaErr);

        const req = { body: { tema: 'Verbos', materia: 'Português', ano: '7º ano' } };
        const res = mockRes();

        await PedagogicoController.gerarPlanoAula(req, res);

        expect(res.statusCode).toBe(200);
        expect(res.body.data.modoOffline).toBe(true);
    });

    it('analisarTurma retorna 200 + modoOffline (mantém metrics) quando o assistente falha', async () => {
        await Aluno.create({ nome: 'Aluno Um', turma: '9A', turmaId: '9A' });

        const netErr = new Error('fetch failed');
        voiceService.generateInsightText.mockRejectedValue(netErr);

        const req = { params: { turmaId: '9A' } };
        const res = mockRes();

        await PedagogicoController.analisarTurma(req, res);

        expect(res.statusCode).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data.modoOffline).toBe(true);
        expect(res.body.data.metrics).toBeDefined();
        expect(res.body.data.metrics.totalAlunos).toBe(1);
        expect(Array.isArray(res.body.data.opcoesSugeridas)).toBe(true);
        expect(res.body.data.insight.toLowerCase()).not.toContain('gemini');
    });

    it('gerarPlanoEstudo retorna 200 + modoOffline quando o assistente falha', async () => {
        const aluno = await Aluno.create({ nome: 'Maria Silva', turma: '8B', turmaId: '8B' });

        PedagogicoService.predictFinalGrade.mockResolvedValue({ prediction: 6.5 });
        const quotaErr = new Error('quota');
        quotaErr.quotaExceeded = true;
        voiceService.generateInsightText.mockRejectedValue(quotaErr);

        const req = { body: { alunoId: String(aluno._id), objetivos: 'Melhorar em matemática' } };
        const res = mockRes();

        await PedagogicoController.gerarPlanoEstudo(req, res);

        expect(res.statusCode).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data.modoOffline).toBe(true);
        expect(Array.isArray(res.body.data.opcoesSugeridas)).toBe(true);
        // Não deve inventar dados: usa o nome real do aluno seedado.
        expect(res.body.data.planoHtml).toContain('Maria Silva');
    });
});

describe('PedagogicoController — comportamento online (assistente disponível)', () => {
    it('gerarPlanoAula retorna o HTML do assistente sem modoOffline quando online', async () => {
        voiceService.generateInsightText.mockResolvedValue('<h3>Plano</h3>');

        const req = { body: { tema: 'Frações', materia: 'Matemática', ano: '9º ano' } };
        const res = mockRes();

        await PedagogicoController.gerarPlanoAula(req, res);

        expect(res.statusCode).toBe(200);
        expect(res.body.data.planoHtml).toBe('<h3>Plano</h3>');
        expect(res.body.data.modoOffline).toBeUndefined();
    });
});
