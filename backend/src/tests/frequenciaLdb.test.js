/**
 * frequenciaLdb.test.js — os limites que a LDB fixa, exercitados nas bordas.
 *
 * ONDE ESTÁ O VALOR DESTES TESTES
 * -------------------------------
 * Nenhuma conta aqui é difícil; o que é difícil é acertar QUANDO cada uma
 * dispara. Errar o gatilho do Conselho Tutelar para mais significa comunicar
 * criança que não precisava — expõe família sem motivo. Errar para menos
 * significa não comunicar quem precisava, que é infração administrativa do
 * art. 245 do ECA e cai sobre a direção da escola.
 *
 * Por isso quase todos os casos abaixo estão em cima do limite: 14 e 15 faltas,
 * 49 e 50. É lá que uma troca de `>=` por `>` passa despercebida em revisão e
 * muda a vida de alguém.
 */
const {
    avaliarFrequencia,
    compararGravidade,
    STATUS,
    DIAS_LETIVOS_PADRAO,
} = require('../services/conformidade/frequenciaLdb');

const anoPadrao = (faltas, extras = {}) =>
    avaliarFrequencia({ faltas, diasLetivosPrevistos: DIAS_LETIVOS_PADRAO, ...extras });

describe('gatilho de comunicação ao Conselho Tutelar (30% do limite legal)', () => {
    it('em 200 dias letivos, o gatilho são 15 faltas — 14 ainda não obrigam', () => {
        // 25% de 200 = 50 faltas de limite; 30% de 50 = 15.
        const antes = anoPadrao(14);
        expect(antes.status).toBe(STATUS.REGULAR);
        expect(antes.exigeComunicacaoConselho).toBe(false);
        expect(antes.faltasAteGatilho).toBe(1);
    });

    it('a 15ª falta obriga a comunicação', () => {
        const alerta = anoPadrao(15);
        expect(alerta.status).toBe(STATUS.ALERTA_CONSELHO_TUTELAR);
        expect(alerta.exigeComunicacaoConselho).toBe(true);
        expect(alerta.gatilhoConselho).toBe(15);
        expect(alerta.baseLegal).toMatch(/13\.803\/2019/);
    });

    it('falta justificada NÃO abona: o atestado explica, não apaga', () => {
        // Na educação básica a justificativa não recompõe frequência. Tratar
        // justificada como presença deixaria de comunicar exatamente a criança
        // cuja família já sinalizou que algo está acontecendo.
        const comAtestado = anoPadrao(15, { justificadas: 15 });
        expect(comAtestado.status).toBe(STATUS.ALERTA_CONSELHO_TUTELAR);
        expect(comAtestado.justificadas).toBe(15);
        expect(comAtestado.naoJustificadas).toBe(0);
    });

    it('não deixa "justificadas" passar do total de faltas', () => {
        // Dado inconsistente vindo do banco não pode produzir contagem negativa
        // de faltas não justificadas num documento oficial.
        const avaliacao = anoPadrao(10, { justificadas: 40 });
        expect(avaliacao.justificadas).toBe(10);
        expect(avaliacao.naoJustificadas).toBe(0);
    });
});

describe('limite de 25% de faltas (LDB, art. 24, VI)', () => {
    it('49 faltas ainda são alerta de Conselho, não risco crítico', () => {
        expect(anoPadrao(49).status).toBe(STATUS.ALERTA_CONSELHO_TUTELAR);
    });

    it('a 50ª falta esgota a margem do ano e vira risco crítico', () => {
        const critico = anoPadrao(50);
        expect(critico.status).toBe(STATUS.RISCO_CRITICO_REPROVACAO);
        expect(critico.limiteFaltas).toBe(50);
        expect(critico.faltasAteLimite).toBe(0);
        expect(critico.baseLegal).toMatch(/art\. 24, VI/);
    });

    it('ano letivo que não é múltiplo de 4 mantém o limite fracionário', () => {
        // 190 dias ⇒ 47,5 faltas. Arredondar para 47 reprovaria quem a lei ainda
        // aprova; para 48, aprovaria quem ela já reprova.
        const avaliacao = avaliarFrequencia({ faltas: 47, diasLetivosPrevistos: 190 });
        expect(avaliacao.limiteFaltas).toBe(47.5);
        expect(avaliacao.status).toBe(STATUS.ALERTA_CONSELHO_TUTELAR);
        expect(avaliarFrequencia({ faltas: 48, diasLetivosPrevistos: 190 }).status).toBe(
            STATUS.RISCO_CRITICO_REPROVACAO
        );
    });
});

describe('percentual de frequência: medido contra os dias já realizados', () => {
    it('em março, 8 faltas em 30 dias de aula são 73%, não 96%', () => {
        // Este é o defeito que o denominador duplo existe para evitar: medir
        // contra os 200 dias do ano inteiro esconderia a evasão em curso.
        const avaliacao = avaliarFrequencia({
            faltas: 8,
            diasLetivosPrevistos: 200,
            diasLetivosRealizados: 30,
        });
        expect(avaliacao.frequenciaPct).toBe(73.3);
        expect(avaliacao.presencas).toBe(22);
        // ...e mesmo com 73% de presença, o dever de comunicar ainda não nasceu:
        // o gatilho legal é contagem absoluta de dias, não percentual.
        expect(avaliacao.status).toBe(STATUS.REGULAR);
    });

    it('sem chamada nenhuma, a frequência é indefinida — não é 100%', () => {
        const avaliacao = avaliarFrequencia({
            faltas: 0,
            diasLetivosPrevistos: 200,
            diasLetivosRealizados: 0,
        });
        expect(avaliacao.frequenciaPct).toBeNull();
        expect(avaliacao.status).toBe(STATUS.REGULAR);
    });

    it('sem ano letivo previsto, não há parâmetro legal a aplicar', () => {
        const avaliacao = avaliarFrequencia({ faltas: 30, diasLetivosPrevistos: 0 });
        expect(avaliacao.status).toBe(STATUS.SEM_PARAMETRO);
        expect(avaliacao.exigeComunicacaoConselho).toBe(false);
    });
});

describe('reprovação por falta só se consuma no fim do ano', () => {
    it('60 faltas em 100 dias realizados é alerta, não reprovação', () => {
        const avaliacao = avaliarFrequencia({
            faltas: 60,
            diasLetivosPrevistos: 200,
            diasLetivosRealizados: 100,
        });
        expect(avaliacao.frequenciaPct).toBe(40);
        expect(avaliacao.reprovadoPorFalta).toBe(false);
        expect(avaliacao.status).toBe(STATUS.RISCO_CRITICO_REPROVACAO);
    });

    it('com o ano encerrado e menos de 75%, sim', () => {
        const avaliacao = avaliarFrequencia({
            faltas: 60,
            diasLetivosPrevistos: 200,
            diasLetivosRealizados: 200,
        });
        expect(avaliacao.reprovadoPorFalta).toBe(true);
    });

    it('75% cravados NÃO reprovam — o mínimo legal é atingido', () => {
        const avaliacao = avaliarFrequencia({
            faltas: 50,
            diasLetivosPrevistos: 200,
            diasLetivosRealizados: 200,
        });
        expect(avaliacao.frequenciaPct).toBe(75);
        expect(avaliacao.reprovadoPorFalta).toBe(false);
        // Continua sendo risco crítico: não sobrou nenhum dia de margem.
        expect(avaliacao.status).toBe(STATUS.RISCO_CRITICO_REPROVACAO);
    });
});

describe('ordenação do painel da secretaria', () => {
    it('põe o caso mais grave primeiro e desempata por número de faltas', () => {
        const lista = [anoPadrao(2), anoPadrao(60), anoPadrao(20), anoPadrao(30)];
        const ordenada = [...lista].sort(compararGravidade);
        expect(ordenada.map((a) => a.faltas)).toEqual([60, 30, 20, 2]);
    });
});
