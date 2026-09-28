/**
 * avisoIndicadores.regressao.test.js — Issue #494
 *
 * Indicadores automáticos sobre aluno ("em risco", tendência, previsão de
 * nota) chegam à tela com o aviso de que são apoio, e o cálculo não grava
 * nada no cadastro do aluno.
 */
const fs = require('node:fs');
const path = require('node:path');
const request = require('supertest');
const app = require('../app');
const Aluno = require('../models/Aluno');
const Nota = require('../models/Nota');
const voiceService = require('../services/voiceService');
const PedagogicoController = require('../controllers/PedagogicoController');
const { AVISO_INDICADOR } = require('../utils/avisoIndicador');
const { conectarBanco, limparBanco, desconectarBanco, criarUsuario } = require('./helpers');
const { assinarTokenSessao } = require('../utils/sessionToken');

function respostaFalsa() {
    const res = {};
    res.status = jest.fn(() => res);
    res.json = jest.fn((corpo) => {
        res.corpo = corpo;
        return res;
    });
    return res;
}

let espiao;

beforeAll(async () => {
    await conectarBanco();
});
afterAll(async () => {
    await desconectarBanco();
});
beforeEach(async () => {
    await limparBanco();
    espiao = jest
        .spyOn(voiceService, 'generateInsightText')
        .mockRejectedValue(new Error('offline'));
});
afterEach(() => {
    espiao.mockRestore();
});

async function alunoComNotas() {
    const aluno = await Aluno.create({ nome: 'Aluno Indicador', turma: '4A' });
    for (const nota of [3, 4, 3.5]) {
        await Nota.create({
            alunoId: String(aluno._id),
            materia: 'Matemática',
            nota,
            data: new Date(),
        });
    }
    return aluno;
}

describe('o aviso acompanha o indicador', () => {
    it('resumo do painel traz o aviso junto de "alunos em risco"', async () => {
        await alunoComNotas();
        const dir = await criarUsuario({ email: 'dir.ind@escola.test', perfil: 'diretor' });
        const res = await request(app)
            .get('/api/dashboard/summary')
            .set('Cookie', [`escola_jwt=${assinarTokenSessao(dir)}`]);
        expect(res.status).toBe(200);
        expect(res.body.data.avisoAlunosRisco).toBe(AVISO_INDICADOR);
    });

    it('análise de desempenho do aluno traz o aviso', async () => {
        const aluno = await alunoComNotas();
        const res = respostaFalsa();
        await PedagogicoController.analisarDesempenho(
            { params: { alunoId: String(aluno._id) } },
            res
        );
        expect(res.corpo.success).toBe(true);
        expect(res.corpo.data.aviso).toBe(AVISO_INDICADOR);
    });

    it('insight global traz o aviso', async () => {
        await alunoComNotas();
        const res = respostaFalsa();
        await PedagogicoController.getGlobalInsights({ escolaId: null }, res);
        expect(res.corpo.data.aviso).toBe(AVISO_INDICADOR);
    });

    it('o aviso não afirma decisão e diz que é apoio', () => {
        expect(AVISO_INDICADOR).toMatch(/apoio/);
        expect(AVISO_INDICADOR).toMatch(/não gera decisão/);
    });
});

describe('sem decisão automática', () => {
    it('calcular os indicadores não altera o cadastro do aluno', async () => {
        const aluno = await alunoComNotas();
        const antes = await Aluno.findById(aluno._id).lean();

        await PedagogicoController.analisarDesempenho(
            { params: { alunoId: String(aluno._id) } },
            respostaFalsa()
        );
        await PedagogicoController.getGlobalInsights({ escolaId: null }, respostaFalsa());

        const depois = await Aluno.findById(aluno._id).lean();
        expect(depois).toEqual(antes);
    });
});

describe('telas', () => {
    const RAIZ = path.resolve(__dirname, '../../..');

    it('o BI pedagógico mostra o aviso do servidor por textContent', () => {
        const js = fs.readFileSync(path.join(RAIZ, 'html/direcao/bi-pedagogico.js'), 'utf8');
        expect(js).toContain('data-aviso-indicador');
        expect(js).toMatch(/avisoEl\.textContent = data\.aviso/);
    });

    it('o painel da direção expõe o aviso no indicador de risco', () => {
        const js = fs.readFileSync(path.join(RAIZ, 'js/painel-direcao.js'), 'utf8');
        expect(js).toContain('dados.avisoAlunosRisco');
    });
});
