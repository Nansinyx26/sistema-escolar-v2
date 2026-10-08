/**
 * modelosGemini.js — a cascata de modelos do Gemini, num lugar só (Issue #703).
 *
 * Há dois caminhos até o Gemini: o streaming do copiloto (`AIProvider`) e as
 * chamadas de texto único do `voiceService` (chatbot legado, plano de aula,
 * insights, PEI, narração). Cada um tinha a própria lista, e a do
 * `voiceService` ficou para trás com `gemini-1.5-flash` e `gemini-1.5-pro`.
 *
 * O valor da cascata está em cada família ter um BALDE DE COTA PRÓPRIO no nível
 * gratuito: estourar o limite por minuto do 2.5-flash não consome o do
 * 2.0-flash, então a cascata realmente devolve resposta em vez de só repetir o
 * mesmo 429.
 *
 * Por isso a lista NÃO pode conter modelo desativado: os 1.5 saíram da API e
 * respondem 404 — duas viagens de rede garantidamente perdidas no meio da
 * cascata, bem no momento em que a pessoa está esperando a resposta.
 */

const MODELO_PADRAO = 'gemini-2.0-flash';

const MODELOS_FALLBACK = [
    'gemini-2.5-flash',
    'gemini-2.0-flash',
    'gemini-2.5-flash-lite',
    'gemini-2.0-flash-lite',
];

/**
 * Ordem de tentativa: o modelo preferido (`IA_MODELO` ou o padrão) e depois a
 * cascata, sem repetir nenhum.
 *
 * @param {string} [preferido]
 * @returns {string[]}
 */
function cascataDeModelos(preferido = process.env.IA_MODELO || MODELO_PADRAO) {
    return [preferido, ...MODELOS_FALLBACK].filter((m, i, arr) => m && arr.indexOf(m) === i);
}

module.exports = { MODELO_PADRAO, MODELOS_FALLBACK, cascataDeModelos };
