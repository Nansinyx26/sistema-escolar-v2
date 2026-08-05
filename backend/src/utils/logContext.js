/**
 * logContext.js — Contexto de requisição propagado automaticamente
 *
 * Usa AsyncLocalStorage (nativo do Node ≥12) para que qualquer `logger.*()`
 * chamado durante uma requisição carregue `requestId`, `userId`, `perfil`,
 * `escolaId` e `action` — sem precisar passar `req` por toda a pilha de chamadas.
 *
 * Este é o ponto que resolve a "ausência de contexto nos logs": em vez de
 * editar centenas de call sites para incluir userId manualmente (o que sempre
 * degrada com o tempo), o contexto viaja junto com a execução assíncrona.
 *
 *   // no controller, sem nenhuma cerimônia:
 *   logger.error('Falha ao salvar nota');
 *   // → {"level":"error","requestId":"a3f8…","userId":"65a1…","escolaId":"…"}
 *
 * Importante para o multi-tenant deste sistema: `escolaId` no log permite
 * auditar se uma requisição vazou para fora da escola da sessão.
 */

'use strict';

const { AsyncLocalStorage } = require('async_hooks');
const crypto = require('crypto');

const storage = new AsyncLocalStorage();

/** Gera um ID de requisição com entropia real (o antigo usava Math.random). */
function generateRequestId() {
    return crypto.randomBytes(8).toString('hex');
}

/**
 * Executa `fn` dentro de um escopo de contexto.
 * Tudo que rodar dentro — inclusive callbacks e awaits — enxerga o contexto.
 */
function run(context, fn) {
    return storage.run(new Map(Object.entries(context)), fn);
}

/** Retorna o contexto atual como objeto simples (`{}` fora de requisição). */
function get() {
    const store = storage.getStore();
    if (!store) return {};
    return Object.fromEntries(store);
}

/**
 * Enriquece o contexto da requisição em andamento.
 * Usado pelo middleware de auth (que só conhece o usuário depois do
 * requestLogger ter rodado) e por controllers que queiram nomear a `action`.
 */
function set(patch = {}) {
    const store = storage.getStore();
    if (!store) return false;
    for (const [k, v] of Object.entries(patch)) {
        if (v !== undefined && v !== null) store.set(k, v);
    }
    return true;
}

/**
 * Nomeia a operação de negócio em curso (ex.: 'aluno.matricular').
 * Torna os logs agregáveis por ação, não só por rota.
 */
function setAction(action) {
    return set({ action });
}

/** Extrai identificação do usuário de `req`, tolerando os vários formatos do projeto. */
function fromRequest(req) {
    const user = req.user || {};
    const ctx = {
        requestId: req.requestId || generateRequestId(),
        method: req.method,
        path: req.originalUrl || req.url,
    };

    const userId = user.id || user._id || user.usuarioId;
    if (userId) ctx.userId = String(userId);
    if (user.perfil) ctx.perfil = user.perfil;

    const escolaId = req.escolaId || user.escolaId;
    if (escolaId) ctx.escolaId = String(escolaId);

    return ctx;
}

module.exports = { run, get, set, setAction, fromRequest, generateRequestId, storage };
