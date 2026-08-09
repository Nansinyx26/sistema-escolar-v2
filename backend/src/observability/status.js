/**
 * observability/status.js — estado consolidado da observabilidade.
 *
 * Vive num módulo próprio, e não dentro de `index.js`, para quebrar um ciclo:
 * o `index.js` expõe os middlewares e o `middleware.js` precisa reportar o
 * estado no endpoint de health. Se cada um requeresse o outro, o
 * `require` devolveria objeto pela metade dependendo de quem carregasse
 * primeiro — o tipo de defeito que só aparece em produção, na ordem errada de
 * inicialização. O contrato de arquitetura (`npm run arch`) reprova ciclos
 * justamente por isso.
 *
 * Aqui só se lê `config`, `otel` e `providers`. Nenhum deles conhece este
 * módulo, então a dependência é sempre em uma direção só.
 */

'use strict';

const config = require('./config');
const otel = require('./otel');
const providers = require('./providers');

/** Visão curta: ligado ou não, e quais provedores. */
function summary() {
    return {
        enabled: !config.disabled && config.activeProviders().length > 0,
        env: config.env,
        release: config.release,
        service: config.serviceName,
        providers: config.activeProviders(),
    };
}

/**
 * Visão detalhada, com o motivo de cada provedor inativo.
 * Não expõe DSN, chave nem endpoint: o retorno é público.
 */
function status() {
    return {
        ...summary(),
        otel: {
            active: otel.started,
            reason: otel.unavailableReason,
        },
        ...providers.status(),
    };
}

module.exports = { summary, status };
