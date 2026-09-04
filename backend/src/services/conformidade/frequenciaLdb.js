/**
 * frequenciaLdb.js — o motor de frequência escolar exigido pela LDB.
 *
 * POR QUE ESTE ARQUIVO EXISTE
 * ---------------------------
 * O sistema já registrava falta (`models/Falta.js`) e já somava falta por
 * bimestre (`Aluno.faltasBimestre`), mas ninguém no código respondia às duas
 * perguntas que a lei faz:
 *
 *   1. este aluno ainda pode ser aprovado? (LDB, art. 24, VI — 75% de
 *      frequência mínima sobre o total de horas letivas); e
 *   2. a escola já é OBRIGADA a comunicar o Conselho Tutelar? (ECA, art. 56, II
 *      c/c LDB art. 12, VIII, na redação da Lei 13.803/2019 — comunicar a
 *      relação de alunos com faltas acima de 30% do percentual permitido).
 *
 * A segunda pergunta é a que gera responsabilização do município: a omissão de
 * comunicação é infração administrativa (ECA, art. 245). Deixar isso na conta
 * de alguém conferir planilha à mão é onde o dever costuma se perder.
 *
 * POR QUE O CÁLCULO MORA AQUI, PURO, SEM BANCO
 * --------------------------------------------
 * O mesmo número precisa aparecer na ficha do aluno, no painel da secretaria,
 * na ficha de encaminhamento ao Conselho e no relatório do diretor. Quatro
 * cópias da mesma conta divergem — e divergência aqui não é bug de tela, é
 * documento oficial com número errado saindo assinado. O arquivo não importa
 * model nenhum de propósito: assim a regra é testável com aritmética pura, e
 * `monitorEvasao.js` fica com a parte que fala com o banco.
 *
 * OS DOIS DENOMINADORES — E POR QUE NÃO DÁ PARA TER SÓ UM
 * ------------------------------------------------------
 * Os gatilhos legais são contagens ABSOLUTAS derivadas do ano letivo previsto
 * (LDB, art. 24, I — mínimo de 200 dias letivos): 25% de 200 = 50 faltas
 * esgotam a frequência mínima, e 30% dessas 50 = 15 faltas obrigam a
 * comunicação. Esses limites não encolhem porque estamos em março.
 *
 * Já o PERCENTUAL de frequência do aluno hoje só faz sentido contra os dias em
 * que a escola de fato fez chamada. Medir 8 faltas contra 200 dias em março
 * diria "96% de frequência" para uma criança que faltou a metade das aulas do
 * ano até agora. Por isso `avaliarFrequencia` recebe os dois e devolve os dois:
 * `frequenciaPct` (situação real até hoje) e os gatilhos (dever legal do ano).
 *
 * FALTA JUSTIFICADA CONTINUA SENDO FALTA
 * --------------------------------------
 * Na educação básica a justificativa não abona a ausência para efeito de
 * frequência mínima — o atestado explica, não apaga. As exceções legais
 * (exercícios domiciliares do Decreto-Lei 1.044/1969, Lei 6.202/1975) são
 * regime especial deferido pela direção, não um checkbox de chamada. Portanto
 * a justificada entra no total e é devolvida à parte, em `justificadas`, para
 * que a secretaria enxergue o contexto antes de acionar o Conselho.
 */

/** LDB, art. 24, VI: 75% de presença mínima ⇒ no máximo 25% de faltas. */
const PERCENTUAL_MINIMO_FREQUENCIA = 75;
const LIMITE_FALTAS_PCT = 0.25;

/**
 * Lei 13.803/2019 (LDB, art. 12, VIII): comunicar ao Conselho Tutelar a relação
 * de alunos com faltas acima de 30% DO PERCENTUAL PERMITIDO — não 30% do ano.
 * Em 200 dias: 30% de 50 faltas = 15 faltas.
 */
const GATILHO_CONSELHO_PCT = 0.3;

/** LDB, art. 24, I — carga mínima anual quando a escola não informa a sua. */
const DIAS_LETIVOS_PADRAO = 200;

/**
 * Situações possíveis, em ordem crescente de gravidade. A ordem importa:
 * `compararGravidade` a usa para ordenar o painel da secretaria pela urgência.
 */
const STATUS = {
    SEM_PARAMETRO: 'SEM_PARAMETRO',
    REGULAR: 'REGULAR',
    ALERTA_CONSELHO_TUTELAR: 'ALERTA_CONSELHO_TUTELAR',
    RISCO_CRITICO_REPROVACAO: 'RISCO_CRITICO_REPROVACAO',
};

const ORDEM_GRAVIDADE = [
    STATUS.SEM_PARAMETRO,
    STATUS.REGULAR,
    STATUS.ALERTA_CONSELHO_TUTELAR,
    STATUS.RISCO_CRITICO_REPROVACAO,
];

const ROTULO = {
    [STATUS.SEM_PARAMETRO]: 'Sem parâmetro de cálculo',
    [STATUS.REGULAR]: 'Frequência regular',
    [STATUS.ALERTA_CONSELHO_TUTELAR]: 'Comunicação obrigatória ao Conselho Tutelar',
    [STATUS.RISCO_CRITICO_REPROVACAO]: 'Risco crítico de reprovação por faltas',
};

/** Texto da base legal que acompanha o alerta em tela e na ficha impressa. */
const BASE_LEGAL = {
    [STATUS.ALERTA_CONSELHO_TUTELAR]:
        'LDB, art. 12, VIII (Lei 13.803/2019) e ECA, art. 56, II — a escola deve ' +
        'comunicar ao Conselho Tutelar a relação de alunos com faltas acima de 30% ' +
        'do percentual permitido em lei.',
    [STATUS.RISCO_CRITICO_REPROVACAO]:
        'LDB, art. 24, VI — exige frequência mínima de 75% do total de horas ' +
        'letivas para aprovação.',
};

/** Arredonda para 1 casa sem herdar o ruído binário do ponto flutuante. */
function umaCasa(valor) {
    return Math.round(valor * 10) / 10;
}

function inteiroNaoNegativo(valor, padrao = 0) {
    const n = Number(valor);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : padrao;
}

/**
 * Avalia a frequência de UM aluno e diz o que a lei exige a partir dela.
 *
 * @param {object} entrada
 * @param {number} entrada.faltas             dias de ausência no ano (justificadas incluídas).
 * @param {number} [entrada.justificadas=0]   quantos desses dias têm justificativa aceita.
 * @param {number} [entrada.diasLetivosPrevistos=200] ano letivo planejado — base dos gatilhos legais.
 * @param {number} [entrada.diasLetivosRealizados]    dias com chamada até hoje — base do percentual.
 * @returns {{
 *   status: string, rotulo: string, baseLegal: string|null,
 *   faltas: number, justificadas: number, naoJustificadas: number,
 *   diasLetivosPrevistos: number, diasLetivosRealizados: number,
 *   frequenciaPct: number|null, presencas: number,
 *   limiteFaltas: number, gatilhoConselho: number,
 *   faltasAteGatilho: number, faltasAteLimite: number,
 *   reprovadoPorFalta: boolean, exigeComunicacaoConselho: boolean
 * }}
 */
function avaliarFrequencia({
    faltas,
    justificadas = 0,
    diasLetivosPrevistos = DIAS_LETIVOS_PADRAO,
    diasLetivosRealizados,
} = {}) {
    const totalFaltas = inteiroNaoNegativo(faltas, 0);
    const previstos = inteiroNaoNegativo(diasLetivosPrevistos, 0);
    // Quando a escola ainda não fez chamada nenhuma, o denominador honesto é 0 —
    // e 0 aqui significa "não dá para afirmar percentual", não "100%".
    const realizados = inteiroNaoNegativo(
        diasLetivosRealizados === undefined ? previstos : diasLetivosRealizados,
        0
    );

    // `limiteFaltas` fica FRACIONÁRIO de propósito quando o ano não é múltiplo
    // de 4 (190 dias ⇒ 47,5). Arredondar para baixo reprovaria quem a lei ainda
    // aprova; para cima, aprovaria quem ela já reprova. A comparação exata
    // abaixo é que decide, e o número exibido é arredondado só na apresentação.
    const limiteFaltas = previstos * LIMITE_FALTAS_PCT;
    const gatilhoConselho = limiteFaltas * GATILHO_CONSELHO_PCT;

    const presencas = Math.max(0, realizados - totalFaltas);
    const frequenciaPct = realizados > 0 ? umaCasa((presencas / realizados) * 100) : null;

    let status;
    if (previstos === 0) {
        status = STATUS.SEM_PARAMETRO;
    } else if (totalFaltas >= limiteFaltas) {
        // Atingir o limite EXATO já esgota toda a margem do ano: com 50 faltas em
        // 200 dias o aluno está em 75% cravados, a um dia da reprovação. O alerta
        // se chama "risco" justamente porque dispara antes do fato consumado.
        status = STATUS.RISCO_CRITICO_REPROVACAO;
    } else if (totalFaltas >= gatilhoConselho) {
        status = STATUS.ALERTA_CONSELHO_TUTELAR;
    } else {
        status = STATUS.REGULAR;
    }

    const justificadasNoLimite = Math.min(inteiroNaoNegativo(justificadas, 0), totalFaltas);

    return {
        status,
        rotulo: ROTULO[status],
        baseLegal: BASE_LEGAL[status] || null,
        faltas: totalFaltas,
        justificadas: justificadasNoLimite,
        naoJustificadas: totalFaltas - justificadasNoLimite,
        diasLetivosPrevistos: previstos,
        diasLetivosRealizados: realizados,
        presencas,
        frequenciaPct,
        limiteFaltas: umaCasa(limiteFaltas),
        gatilhoConselho: umaCasa(gatilhoConselho),
        faltasAteGatilho: Math.max(0, umaCasa(gatilhoConselho - totalFaltas)),
        faltasAteLimite: Math.max(0, umaCasa(limiteFaltas - totalFaltas)),
        // A reprovação por falta só se consuma ABAIXO de 75% — e só ao fim do
        // ano, quando `realizados` alcança `previstos`. Meio de ano com 60% não
        // é reprovação, é o alerta acima pedindo providência a tempo.
        reprovadoPorFalta:
            realizados >= previstos &&
            previstos > 0 &&
            frequenciaPct !== null &&
            frequenciaPct < PERCENTUAL_MINIMO_FREQUENCIA,
        exigeComunicacaoConselho:
            status === STATUS.ALERTA_CONSELHO_TUTELAR || status === STATUS.RISCO_CRITICO_REPROVACAO,
    };
}

/**
 * Ordenação por urgência (mais grave primeiro), para o painel da secretaria.
 * Empate no status desempata por quem tem mais faltas.
 */
function compararGravidade(a, b) {
    const peso = (x) => ORDEM_GRAVIDADE.indexOf(x?.status);
    const diff = peso(b) - peso(a);
    return diff !== 0 ? diff : (b?.faltas || 0) - (a?.faltas || 0);
}

module.exports = {
    PERCENTUAL_MINIMO_FREQUENCIA,
    LIMITE_FALTAS_PCT,
    GATILHO_CONSELHO_PCT,
    DIAS_LETIVOS_PADRAO,
    STATUS,
    ROTULO,
    BASE_LEGAL,
    avaliarFrequencia,
    compararGravidade,
};
