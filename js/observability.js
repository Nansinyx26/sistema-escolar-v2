/**
 * observability.js — captura de erros do navegador.
 *
 * Não carrega SDK de terceiro. Dois motivos:
 *
 *   1. CSP — o backend trava `script-src` em `'self'` + hashes SHA-256 dos
 *      inline (backend/src/utils/cspHashes.js). Script de CDN não executaria,
 *      e afrouxar a CSP para caber um SDK de APM seria trocar segurança real
 *      por observabilidade.
 *   2. Privacidade — encaminhando pelo backend, o mesmo scrub de PII do
 *      servidor se aplica ao que sai do navegador, e o DSN não vai para o HTML.
 *
 * Coleta window.onerror + unhandledrejection e envia para
 * POST /api/observability/frontend-error.
 *
 * Ver docs/OBSERVABILITY.md.
 */
(function (global) {
    "use strict";

    if (global.Observability && global.Observability.__installed) return;

    var _doc = global.document;
    var ENDPOINT = "/api/observability/frontend-error";

    // Teto por sessão: um laço de render quebrado não pode virar enxurrada de
    // requisição nem estourar a cota do provedor.
    var MAX_POR_SESSAO = 10;
    var enviados = 0;

    // Erros idênticos em sequência contam uma vez só.
    var vistos = new Set();

    /** Ruído conhecido que não representa defeito do sistema. */
    var IGNORAR = [
        /ResizeObserver loop/i,
        /Script error\.?$/i, // erro cross-origin sem detalhe: inútil
        /Non-Error promise rejection/i,
        /AbortError/i,
        /NetworkError when attempting to fetch/i,
    ];

    function deveIgnorar(mensagem) {
        if (!mensagem) return true;
        for (var i = 0; i < IGNORAR.length; i++) {
            if (IGNORAR[i].test(mensagem)) return true;
        }
        return false;
    }

    /**
     * Remove da URL o que possa identificar alguém antes de mandar para o
     * servidor. O backend higieniza de novo — aqui é a primeira barreira.
     */
    function paginaSegura() {
        try {
            var u = new URL(global.location.href);
            ["cpf", "email", "telefone", "token", "senha", "codigo"].forEach(function (p) {
                if (u.searchParams.has(p)) u.searchParams.set(p, "[REDACTED]");
            });
            return u.pathname + u.search;
        } catch (_e) {
            return global.location ? global.location.pathname : "";
        }
    }

    function reportar(dados) {
        if (enviados >= MAX_POR_SESSAO) return;

        var chave = (dados.name || "") + "|" + (dados.message || "");
        if (vistos.has(chave)) return;
        vistos.add(chave);
        enviados++;

        var payload = JSON.stringify({
            name: dados.name || "FrontendError",
            message: String(dados.message || "").slice(0, 1000),
            stack: dados.stack ? String(dados.stack).slice(0, 8000) : undefined,
            pagina: paginaSegura(),
        });

        try {
            // sendBeacon sobrevive à navegação — o erro que acontece ao sair
            // da página é justamente o que mais se perde.
            if (global.navigator && global.navigator.sendBeacon) {
                var blob = new Blob([payload], { type: "application/json" });
                if (global.navigator.sendBeacon(ENDPOINT, blob)) return;
            }

            // X-Motion-Silent: telemetria não acende a barra de progresso.
            global
                .fetch(ENDPOINT, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        "X-Motion-Silent": "1",
                    },
                    body: payload,
                    keepalive: true,
                    credentials: "same-origin",
                })
                .catch(function () {
                    // Falhar ao reportar erro não pode gerar outro erro.
                });
        } catch (_e) {
            // Idem.
        }
    }

    global.addEventListener("error", function (ev) {
        // Erro de carregamento de recurso (img/script) não tem ev.error.
        if (ev && ev.target && ev.target !== global && ev.target.tagName) {
            return;
        }
        if (!ev || deveIgnorar(ev.message)) return;

        reportar({
            name: ev.error && ev.error.name,
            message: ev.message,
            stack: ev.error && ev.error.stack,
        });
    });

    global.addEventListener("unhandledrejection", function (ev) {
        var motivo = ev && ev.reason;
        var mensagem = motivo && motivo.message ? motivo.message : String(motivo);
        if (deveIgnorar(mensagem)) return;

        reportar({
            name: (motivo && motivo.name) || "UnhandledRejection",
            message: mensagem,
            stack: motivo && motivo.stack,
        });
    });

    var Observability = {
        __installed: true,

        /** Reporte manual, para erro já tratado que ainda interessa saber. */
        captureException: function (erro, contexto) {
            if (!erro) return;
            reportar({
                name: erro.name,
                message: erro.message + (contexto ? " | " + JSON.stringify(contexto) : ""),
                stack: erro.stack,
            });
        },

        /** Correlaciona com o backend: o servidor devolve X-Trace-Id. */
        traceIdDaResposta: function (response) {
            try {
                return response && response.headers ? response.headers.get("X-Trace-Id") : null;
            } catch (_e) {
                return null;
            }
        },
    };

    global.Observability = Observability;
})(typeof window !== "undefined" ? window : this);
