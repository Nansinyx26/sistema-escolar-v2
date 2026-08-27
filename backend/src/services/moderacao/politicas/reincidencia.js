/**
 * reincidencia.js — a regra de agravamento de §5.1.
 *
 * "3 ocorrências LEVE+ do mesmo usuário em 30 dias ⇒ a próxima LEVE é tratada
 * como MODERADA."
 *
 * Fica separado da matriz porque é a única parte da política que precisa ir ao
 * banco. A matriz continua uma função pura que recebe `reincidente: true|false`
 * — dá para testar a tabela inteira sem subir Mongo, e dá para testar a
 * contagem sem passar pela tabela.
 */

const ModeracaoOcorrencia = require('../../../models/ModeracaoOcorrencia');

const JANELA_DIAS = 30;
const LIMIAR = 3;

/**
 * Quantas ocorrências este remetente acumulou na janela.
 *
 * Conta apenas ocorrências que continuam valendo: uma decisão REVERTIDA pela
 * revisão humana não pode pesar contra a pessoa depois — se pesasse, o falso
 * positivo que a escola já reconheceu como erro continuaria produzindo efeito,
 * e a revisão viraria teatro.
 *
 * @param {string} remetenteId
 * @param {Object} [opcoes]
 * @param {string} [opcoes.escolaId] Restringe a contagem ao tenant (P4).
 * @param {Date}   [opcoes.agora]    Injetável para teste.
 * @returns {Promise<number>}
 */
async function contarOcorrencias(remetenteId, opcoes = {}) {
    if (!remetenteId) return 0;

    const agora = opcoes.agora ? new Date(opcoes.agora) : new Date();
    const desde = new Date(agora.getTime() - JANELA_DIAS * 24 * 60 * 60 * 1000);

    const filtro = {
        remetenteId: String(remetenteId),
        criadoEm: { $gte: desde },
        statusAtual: { $ne: 'revertida' },
    };
    if (opcoes.escolaId) filtro.escolaId = String(opcoes.escolaId);

    return ModeracaoOcorrencia.countDocuments(filtro);
}

/**
 * O remetente já cruzou o limiar?
 *
 * @returns {Promise<boolean>}
 */
async function ehReincidente(remetenteId, opcoes = {}) {
    const total = await contarOcorrencias(remetenteId, opcoes);
    return total >= LIMIAR;
}

module.exports = { contarOcorrencias, ehReincidente, JANELA_DIAS, LIMIAR };
