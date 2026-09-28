/**
 * iaPedagogico.regressao.test.js — Issue #493 (continuação da #401)
 *
 * As funções pedagógicas geram texto por `voiceService.generateInsightText`,
 * que fala direto com o provedor. O insight global mandava o nome dos alunos
 * com frequência crítica, e nenhuma delas consultava o interruptor de IA por
 * escola. Aqui o provedor é simulado e o texto enviado é inspecionado.
 */
const Escola = require('../models/Escola');
const Aluno = require('../models/Aluno');
const voiceService = require('../services/voiceService');
const PedagogicoService = require('../services/PedagogicoService');
const PedagogicoController = require('../controllers/PedagogicoController');
const { limparCache } = require('../services/ia/interruptor');
const { conectarBanco, limparBanco, desconectarBanco } = require('./helpers');

const NOMES = ['Joaquim Teixeira', 'Helena Barbosa'];

let espiao;

async function escolaCom(iaHabilitada) {
    const escola = await Escola.create({
        nome: 'EMEF IA',
        tipo: 'EMEF',
        ativo: true,
        iaHabilitada,
    });
    for (const nome of NOMES) {
        await Aluno.create({
            nome,
            turma: '5A',
            escolaId: String(escola._id),
            faltasBimestre: { b1: 30, b2: 30 },
        });
    }
    return String(escola._id);
}

function respostaFalsa() {
    const res = {};
    res.status = jest.fn(() => res);
    res.json = jest.fn((corpo) => {
        res.corpo = corpo;
        return res;
    });
    return res;
}

beforeAll(async () => {
    await conectarBanco();
});
afterAll(async () => {
    await desconectarBanco();
});
beforeEach(async () => {
    await limparBanco();
    limparCache();
    espiao = jest.spyOn(voiceService, 'generateInsightText');
});
afterEach(() => {
    espiao.mockRestore();
});

describe('insight global da direção', () => {
    it('o texto enviado ao provedor não leva nome de aluno; a resposta volta com o nome no servidor', async () => {
        const escolaId = await escolaCom(true);
        espiao.mockResolvedValue(
            'Visão geral. Pontos de atenção: Aluno A e Aluno B com muitas faltas.'
        );

        const resultado = await PedagogicoService.getGlobalInsights(escolaId);

        expect(espiao).toHaveBeenCalledTimes(1);
        const enviado = espiao.mock.calls[0][0];
        for (const nome of NOMES) {
            expect(enviado).not.toContain(nome);
            expect(enviado).not.toContain(nome.split(' ')[0]);
        }
        expect(enviado).toMatch(/Aluno A/);

        // Reidentificado aqui, depois de voltar do provedor.
        const nomesNaResposta = NOMES.filter((n) => resultado.sumario.includes(n));
        expect(nomesNaResposta.length).toBeGreaterThan(0);
    });

    it('escola sem adesão à IA: o provedor não é chamado e o resumo local é devolvido', async () => {
        const escolaId = await escolaCom(false);

        const resultado = await PedagogicoService.getGlobalInsights(escolaId);

        expect(espiao).not.toHaveBeenCalled();
        expect(resultado.alunosRisco).toBe(2);
        expect(typeof resultado.sumario).toBe('string');
    });
});

describe('plano de aula, plano de estudo e análise da turma', () => {
    it('escola sem adesão: plano de aula sai offline, sem chamar o provedor', async () => {
        const escolaId = await escolaCom(false);
        const res = respostaFalsa();

        await PedagogicoController.gerarPlanoAula(
            {
                body: { tema: 'Frações', materia: 'Matemática', ano: '5º ano' },
                escolaId,
                user: { perfil: 'professor' },
            },
            res
        );

        expect(espiao).not.toHaveBeenCalled();
        expect(res.corpo.data.modoOffline).toBe(true);
    });

    it('escola com adesão: plano de aula chama o provedor', async () => {
        const escolaId = await escolaCom(true);
        espiao.mockResolvedValue('<h3>Plano</h3>');
        const res = respostaFalsa();

        await PedagogicoController.gerarPlanoAula(
            {
                body: { tema: 'Frações', materia: 'Matemática', ano: '5º ano' },
                escolaId,
                user: { perfil: 'professor' },
            },
            res
        );

        expect(espiao).toHaveBeenCalledTimes(1);
        expect(res.corpo.data.planoHtml).toBe('<h3>Plano</h3>');
    });
});
