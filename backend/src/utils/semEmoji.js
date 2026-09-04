/**
 * semEmoji.js
 * ============================================================================
 * Remove emojis do TEXTO GERADO PELO ASSISTENTE — de forma determinística.
 *
 * POR QUE ISTO EXISTE, SE O PROMPT JÁ PROÍBE
 * ------------------------------------------
 * `assistantPersona.js` diz "NUNCA use emojis" e `ChatbotService` repete a
 * regra no prompt da camada conversacional. Instrução de prompt é PEDIDO, não
 * garantia: um modelo generativo desobedece com frequência baixa e não nula, e
 * "baixa e não nula" numa escola significa que alguém, algum dia, recebe a nota
 * do filho com um emoji do lado. A regra no prompt continua valendo — ela
 * melhora o texto na origem — e este filtro é o que a torna verdadeira.
 *
 * ESCOPO: SÓ A SAÍDA DO MODELO
 * ----------------------------
 * Isto NÃO é para ser aplicado em texto de pessoa. O chat direto entre
 * usuários (`js/chat-direto-manager.js`) e as reações (`js/reactions.js`) têm
 * seletor de emoji de propósito — ali o emoji é o conteúdo. O alvo aqui é
 * exclusivamente o que o assistente escreve.
 *
 * O QUE NÃO É REMOVIDO
 * --------------------
 * `©`, `®` e `™` são classificados como Extended_Pictographic pelo Unicode,
 * mas em português corrente eles são pontuação de texto, não decoração. Sair
 * removendo-os transformaria "Windows®" em "Windows" numa resposta sobre
 * tecnologia. Ficam de fora.
 * ============================================================================
 */

// Sinais que só existem para MODIFICAR ou EMENDAR um emoji: seletor de
// variação (U+FE0F), joiner de sequência (U+200D), cobertura de keycap
// (U+20E3) e os cinco tons de pele (Emoji_Modifier).
const MODIFICADOR = '(?:\\uFE0F|\\p{Emoji_Modifier})';

// Um pictograma isolado, menos os três sinais tipográficos ressalvados acima.
const PICTOGRAMA = '(?![\\u00A9\\u00AE\\u2122])\\p{Extended_Pictographic}';

/**
 * Uma unidade de emoji completa. A ordem das alternativas importa: a sequência
 * com ZWJ vem PRIMEIRO para que "👨‍🏫" saia inteiro em vez de sobrar o "🏫" do
 * segundo pictograma como resíduo visível.
 */
const UNIDADE = [
    // Sequência emendada por ZWJ: família, profissões, bandeiras compostas.
    `${PICTOGRAMA}${MODIFICADOR}?(?:\\u200D${PICTOGRAMA}${MODIFICADOR}?)*`,
    // Keycap: dígito/#/* + seletor de variação + cobertura.
    '[#*0-9]\\uFE0F?\\u20E3',
    // Bandeira de país: par de indicadores regionais.
    '\\p{Regional_Indicator}{2}',
].join('|');

/**
 * Um ou mais emojis seguidos, com o espaço em branco horizontal em volta.
 *
 * Capturar o espaço é o que evita o rastro do buraco: sem isso,
 * "Olá! 😊 Sou" viraria "Olá!  Sou" com espaço duplo, e "por aqui. 👋" ficaria
 * com um espaço pendurado no fim da frase.
 */
const RE_EMOJI = new RegExp(`([ \\t]*)(?:${UNIDADE})+([ \\t]*)`, 'gu');

/**
 * Caracteres que podem ser o COMEÇO de um emoji ainda incompleto no fim de um
 * chunk de streaming — inclui o surrogate alto solto, que é como um emoji
 * partido no meio chega quando o provedor corta o texto entre dois bytes.
 */
const RE_CAUDA_INCERTA = new RegExp(
    `(?:[\\s\\u200D\\uFE0F\\u20E3#*0-9\\uD800-\\uDBFF]|\\p{Extended_Pictographic}|\\p{Emoji_Modifier}|\\p{Regional_Indicator})*$`,
    'u'
);

/**
 * Remove os emojis de um texto completo.
 *
 * @param {string} texto
 * @returns {string} O mesmo texto sem emojis e sem espaço duplo no lugar deles.
 */
function removerEmojis(texto) {
    if (typeof texto !== 'string' || !texto) return texto;

    // Emoji entre duas palavras deixa UM espaço (era separador); emoji no fim
    // da frase, ou colado numa palavra, não deixa nada.
    return texto.replace(RE_EMOJI, (_todo, antes, depois) =>
        (antes && depois ? ' ' : '')
    );
}

/**
 * Filtro com estado, para texto que chega em pedaços (o SSE do copiloto).
 *
 * O PROBLEMA QUE ELE RESOLVE
 * --------------------------
 * Aplicar `removerEmojis` chunk a chunk não funciona: o provedor pode cortar
 * "👨‍🏫" entre o ZWJ e o segundo pictograma, e cada metade, vista sozinha, não
 * casa com a sequência completa — o resultado sai partido na tela.
 *
 * A solução é segurar a CAUDA duvidosa: o que fica no fim do chunk e ainda
 * poderia crescer para virar um emoji. Ela volta grudada no começo do chunk
 * seguinte, e `finalizar()` libera o que sobrou quando o stream acaba. O custo
 * é atrasar em um chunk um espaço ou um dígito final — imperceptível num
 * stream de texto.
 *
 * @returns {{escrever: (chunk: string) => string, finalizar: () => string}}
 */
function criarFiltroEmoji() {
    let pendente = '';

    return {
        /**
         * @param {string} chunk Pedaço cru vindo do provedor.
         * @returns {string} A parte já segura para exibir e persistir.
         */
        escrever(chunk) {
            if (typeof chunk !== 'string' || !chunk) return '';

            const texto = pendente + chunk;
            const cauda = texto.match(RE_CAUDA_INCERTA)?.[0] ?? '';

            // A cauda pode ser o chunk inteiro (uma rajada só de espaços, ou um
            // emoji chegando devagar). Nesse caso nada é liberado nesta volta.
            pendente = cauda;
            return removerEmojis(texto.slice(0, texto.length - cauda.length));
        },

        /**
         * Libera a cauda retida. Chamar SEMPRE ao fim do stream — inclusive
         * quando ele foi abortado, senão o último espaço (ou o último dígito de
         * um número) some da resposta.
         *
         * @returns {string}
         */
        finalizar() {
            const resto = removerEmojis(pendente);
            pendente = '';
            return resto;
        },
    };
}

module.exports = { removerEmojis, criarFiltroEmoji };
