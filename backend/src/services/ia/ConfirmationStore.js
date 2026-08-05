'use strict';

/**
 * ConfirmationStore.js — emissão e consumo dos tokens de confirmação.
 *
 * O CONTRATO
 * ----------
 * Nenhuma ferramenta com `mutates: true` escreve na primeira chamada. Ela
 * devolve um PREVIEW; este módulo guarda os parâmetros no servidor e emite um
 * token. Só `POST /api/ia/confirmar`, com esse token, executa de fato.
 *
 * TRÊS PROPRIEDADES QUE O CONSUMO PRECISA TER
 * -------------------------------------------
 * 1. USO ÚNICO — garantido por `findOneAndDelete`, que é atômico no MongoDB.
 *    Duas requisições simultâneas com o mesmo token: uma pega o documento, a
 *    outra recebe null. Ler-e-depois-apagar teria uma janela de corrida em que
 *    as duas executariam (comunicado enviado duas vezes, turma duplicada).
 * 2. VALIDADE CURTA — 5 minutos, checados no consumo. O índice TTL é limpeza
 *    de fundo e varre a cada ~60s; confiar só nele deixaria um token válido
 *    por até um minuto além do prazo.
 * 3. VÍNCULO COM O DONO — o filtro do consumo inclui usuário e escola. Um
 *    token que vaze não vale nas mãos de outra pessoa.
 */

const crypto = require('crypto');
const IaAcaoPendente = require('../../models/IaAcaoPendente');
const logger = require('../../utils/logger');

const TTL_MINUTOS = IaAcaoPendente.TTL_MINUTOS || 5;

/** O cliente recebe o token em claro; o banco guarda só o hash. */
function hashDe(token) {
    return crypto.createHash('sha256').update(String(token)).digest('hex');
}

/**
 * Registra uma ação pendente e devolve o token para o cliente.
 *
 * @param {Object} ctx        contexto de ferramenta (usuário/escola do servidor)
 * @param {Object} acao       { ferramenta, parametros, resumo }
 * @returns {Promise<{confirmToken: string, expiraEm: Date}>}
 */
async function emitir(ctx, { ferramenta, parametros, resumo }) {
    const token = crypto.randomUUID();
    const expiraEm = new Date(Date.now() + TTL_MINUTOS * 60 * 1000);

    await IaAcaoPendente.create({
        tokenHash: hashDe(token),
        usuarioId: String(ctx.usuarioId),
        escolaId: ctx.escolaId ? String(ctx.escolaId) : null,
        perfil: ctx.perfil,
        ferramenta,
        parametros: parametros || {},
        resumo,
        expiraEm
    });

    return { confirmToken: token, expiraEm };
}

/**
 * Consome o token: devolve a ação e a remove, em uma operação só.
 *
 * @returns {Promise<{ok: boolean, acao?: Object, erro?: string}>}
 */
async function consumir(ctx, token) {
    if (!token || typeof token !== 'string') {
        return { ok: false, erro: 'Confirmação inválida.' };
    }

    // Atômico: quem pegar o documento executa; qualquer outra tentativa com o
    // mesmo token encontra null.
    const acao = await IaAcaoPendente.findOneAndDelete({
        tokenHash: hashDe(token),
        usuarioId: String(ctx.usuarioId),
        escolaId: ctx.escolaId ? String(ctx.escolaId) : null
    }).lean();

    if (!acao) {
        // Mensagem única para inexistente, já usado, expirado e de outra
        // pessoa: distinguir os casos entregaria um oráculo de tokens válidos.
        return { ok: false, erro: 'Esta confirmação não é mais válida. Peça a ação novamente ao assistente.' };
    }

    if (acao.expiraEm && acao.expiraEm.getTime() < Date.now()) {
        logger.info('[IA] Token de confirmação expirado foi descartado.', {
            action: 'ia.confirmar', ferramenta: acao.ferramenta
        });
        return { ok: false, erro: 'O prazo desta confirmação expirou. Peça a ação novamente ao assistente.' };
    }

    // MUDANÇA DE PRIVILÉGIO ENTRE O PEDIDO E A CONFIRMAÇÃO.
    // O perfil vem do banco a cada requisição (ver authJWT), então um
    // rebaixamento no meio dos 5 minutos é visível aqui. Quem pediu como
    // diretor não confirma como professor.
    if (acao.perfil !== ctx.perfil) {
        logger.warn('[IA] Perfil mudou entre o pedido e a confirmação — ação descartada.', {
            action: 'ia.confirmar', ferramenta: acao.ferramenta,
            perfilNoPedido: acao.perfil, perfilAgora: ctx.perfil
        });
        return { ok: false, erro: 'Suas permissões mudaram desde que a ação foi preparada. Peça novamente.' };
    }

    return { ok: true, acao };
}

/** Cancela uma ação sem executá-la (botão "Cancelar" da interface). */
async function cancelar(ctx, token) {
    if (!token) return false;
    const r = await IaAcaoPendente.deleteOne({
        tokenHash: hashDe(token),
        usuarioId: String(ctx.usuarioId)
    });
    return r.deletedCount > 0;
}

module.exports = { emitir, consumir, cancelar, TTL_MINUTOS, hashDe };
