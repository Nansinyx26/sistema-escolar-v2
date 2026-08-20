/**
 * formatarPresenca.js — transforma presença em texto que a pessoa entende.
 *
 * O QUE ISTO RESOLVE (Issue #70)
 * -----------------------------
 * `realtime/presence.js` devolve dado cru: um status e um `Date`. O cabeçalho
 * da conversa precisa de "visto por último hoje às 14:32". Sem um lugar único
 * para essa conversão, cada tela inventa a sua e elas divergem — a lista de
 * contatos diz uma coisa e o cabeçalho diz outra sobre a mesma pessoa.
 *
 * FUSO HORÁRIO: O PONTO INTEIRO DESTE ARQUIVO
 * -------------------------------------------
 * O servidor roda em UTC no Render; a escola vive em São Paulo, 3 horas atrás.
 * Formatar sem fixar o fuso faz o texto ficar errado todas as noites: às 21h
 * de São Paulo já é o dia seguinte em UTC, então "hoje às 21:30" viraria
 * "ontem às 00:30". O erro só aparece à noite, some de manhã, e some também na
 * máquina de quem desenvolve — que está no fuso certo. É o tipo de bug que
 * vira "só acontece às vezes" e nunca é reproduzido.
 *
 * Por isso o fuso é FIXO aqui, não herdado do processo: `America/Sao_Paulo`, a
 * mesma constante que os controllers do projeto já usam.
 *
 * POR QUE COMPARAR DATAS CIVIS, E NÃO SUBTRAIR HORAS
 * -------------------------------------------------
 * "Hoje" e "ontem" são perguntas de CALENDÁRIO, não de duração. Às 00:30, algo
 * de 23:50 aconteceu há 40 minutos e mesmo assim foi ontem; às 23:50, algo de
 * 00:30 tem quase 24 horas e ainda é hoje. Quem implementa com
 * `agora - data < 24h` acerta na maior parte do dia e erra na virada.
 *
 * A comparação abaixo é entre datas civis em São Paulo no formato AAAA-MM-DD,
 * e a subtração do "ontem" acontece sobre esse calendário — nunca sobre um
 * instante. É o que mantém o resultado correto na mudança de horário de verão,
 * quando um dia tem 23 ou 25 horas.
 *
 * LGPD: "visto por último" revela rotina — a que horas alguém acorda, se
 * trabalhou no fim de semana. Este módulo só FORMATA; decidir quem pode ver a
 * presença de quem é da camada que monta a resposta (ver a lista de contatos
 * permitidos e `services/vinculoTurmas.js`). Nunca envie este texto para quem
 * não teria permissão de conversar com a pessoa.
 */

/** Fuso das escolas. Fixo de propósito — ver o cabeçalho. */
const FUSO = 'America/Sao_Paulo';

/** Data civil em São Paulo, como 'AAAA-MM-DD'. `en-CA` já emite nessa ordem. */
const FMT_DIA = new Intl.DateTimeFormat('en-CA', {
    timeZone: FUSO,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
});

/** Hora e minuto em São Paulo, como '14:32'. */
const FMT_HORA = new Intl.DateTimeFormat('pt-BR', {
    timeZone: FUSO,
    hour: '2-digit',
    minute: '2-digit',
});

/** Dia e mês, como '12/08'. */
const FMT_DIA_MES = new Intl.DateTimeFormat('pt-BR', {
    timeZone: FUSO,
    day: '2-digit',
    month: '2-digit',
});

/** Data completa, como '12/08/2025'. */
const FMT_DATA_COMPLETA = new Intl.DateTimeFormat('pt-BR', {
    timeZone: FUSO,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
});

/** `Date` válido? Protege contra `new Date('lixo')`, que não lança. */
function ehDataValida(valor) {
    return valor instanceof Date && !Number.isNaN(valor.getTime());
}

/**
 * Véspera de uma data civil 'AAAA-MM-DD'.
 *
 * A aritmética roda em UTC sobre a data já isolada do relógio, então ela não
 * atravessa fuso nem horário de verão: 1 de março menos um dia é 28 ou 29 de
 * fevereiro pelo calendário, independentemente de quantas horas aquele dia teve.
 */
function diaAnterior(diaCivil) {
    const [ano, mes, dia] = diaCivil.split('-').map(Number);
    const data = new Date(Date.UTC(ano, mes - 1, dia));
    data.setUTCDate(data.getUTCDate() - 1);
    return data.toISOString().slice(0, 10);
}

/**
 * "hoje às 14:32", "ontem às 09:15", "em 12/08 às 08:00".
 *
 * O ano só aparece quando é outro — dentro do ano corrente ele é ruído, e o
 * cabeçalho da conversa é estreito.
 *
 * @param {Date} data momento do último acesso
 * @param {Date} [agora] injetável para o teste poder fixar "hoje"
 * @returns {string} vazio quando a data não serve
 */
function textoUltimoAcesso(data, agora = new Date()) {
    if (!ehDataValida(data) || !ehDataValida(agora)) return '';

    // Relógio do cliente adiantado, ou registro gravado com folga, produziriam
    // "visto por último amanhã". Tratar o futuro como agora é a leitura menos
    // errada: a pessoa esteve ali, o carimbo é que não presta.
    const momento = data.getTime() > agora.getTime() ? agora : data;

    const hora = FMT_HORA.format(momento);
    const diaDoAcesso = FMT_DIA.format(momento);
    const hoje = FMT_DIA.format(agora);

    if (diaDoAcesso === hoje) return `hoje às ${hora}`;
    if (diaDoAcesso === diaAnterior(hoje)) return `ontem às ${hora}`;

    const mesmoAno = diaDoAcesso.slice(0, 4) === hoje.slice(0, 4);
    const dataTexto = mesmoAno ? FMT_DIA_MES.format(momento) : FMT_DATA_COMPLETA.format(momento);

    return `em ${dataTexto} às ${hora}`;
}

/**
 * Linha de presença pronta para o cabeçalho da conversa.
 *
 * Recebe o formato que `realtime/presence.js` já devolve em `infoDe()`, para
 * não obrigar o chamador a desmontar e remontar o objeto.
 *
 * Quem está online não mostra "visto por último" — é o comportamento que as
 * pessoas esperam de um mensageiro, e repetir a última atividade de alguém que
 * está ali na hora só entrega rotina sem informar nada.
 *
 * `ausente` existe neste projeto e não no WhatsApp: significa conectado com
 * todas as abas ociosas. Fica com rótulo próprio porque agrupá-lo em "online"
 * prometeria uma resposta imediata que talvez não venha.
 *
 * @param {{status?: string, ultimoAcesso?: Date|string|null}} info
 * @param {Date} [agora] injetável para teste
 * @returns {string} 'online' | 'ausente' | 'visto por último ...' | 'offline'
 */
function formatarPresenca(info, agora = new Date()) {
    const status = String(info?.status || 'offline').toLowerCase();

    if (status === 'online') return 'online';
    if (status === 'ausente') return 'ausente';

    // Aceita string porque a presença pode chegar serializada de um socket ou
    // de um JSON — recusar aí só empurraria a conversão para o chamador.
    const bruto = info?.ultimoAcesso;
    const data = bruto instanceof Date ? bruto : bruto ? new Date(bruto) : null;

    const texto = data ? textoUltimoAcesso(data, agora) : '';

    // Sem último acesso conhecido — conta nova, ou o processo reiniciou e a
    // presença, que é em memória, se perdeu. "offline" é honesto; inventar um
    // horário seria pior do que não dizer nada.
    return texto ? `visto por último ${texto}` : 'offline';
}

module.exports = { formatarPresenca, textoUltimoAcesso, FUSO };
