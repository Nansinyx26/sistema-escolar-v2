/**
 * observability/providers.js — Sentry, Datadog e New Relic.
 *
 * Cada um é OPCIONAL em dois níveis:
 *   1. O pacote npm pode não estar instalado (require devolve null, sem erro)
 *   2. Mesmo instalado, só liga com a env de habilitação + credencial
 *
 * Nenhum provedor pode derrubar o boot. Observabilidade que impede o sistema de
 * subir é pior que a falta dela: a escola fica sem sistema por causa do painel.
 *
 * DIVISÃO DE PAPÉIS
 *   OpenTelemetry → traces e métricas (base vendor-neutral, ver otel.js)
 *   Sentry        → exceções, agrupamento, release health
 *   Datadog       → APM + infraestrutura, quando a escola já usa Datadog
 *   New Relic     → APM alternativo; NÃO rode junto com Datadog em produção
 */

const config = require('./config');
const { scrubEvent } = require('./scrub');

function optional(moduleName) {
    try {
        return require(moduleName);
    } catch (err) {
        if (err && err.code === 'MODULE_NOT_FOUND') return null;
        throw err;
    }
}

const state = {
    sentry: { active: false, client: null, reason: null },
    datadog: { active: false, client: null, reason: null },
    newrelic: { active: false, client: null, reason: null },
};

/* ------------------------------------------------------------------ Sentry */

function startSentry() {
    if (!config.sentry.enabled || config.disabled) return;

    const Sentry = optional('@sentry/node');
    if (!Sentry) {
        state.sentry.reason = '@sentry/node não instalado';
        return;
    }

    try {
        Sentry.init({
            dsn: config.sentry.dsn,
            environment: config.env,
            release: config.release,
            tracesSampleRate: config.tracesSampleRate,
            profilesSampleRate: config.sentry.profilesSampleRate,

            // Desligado: o corpo da requisição carrega dado de aluno.
            sendDefaultPii: false,

            // Última barreira antes do envio. Se `scrubEvent` devolver null,
            // o evento é descartado — ver scrub.js.
            beforeSend(event) {
                return scrubEvent(event);
            },
            beforeSendTransaction(event) {
                return scrubEvent(event);
            },

            beforeBreadcrumb(crumb) {
                // Breadcrumb de console reproduz log inteiro; já temos o Pino.
                if (crumb.category === 'console') return null;
                return crumb;
            },

            ignoreErrors: [
                'AbortError',
                'ResizeObserver loop limit exceeded',
                /ECONNRESET/,
                /EPIPE/,
            ],
        });

        state.sentry.client = Sentry;
        state.sentry.active = true;
    } catch (err) {
        state.sentry.reason = `falha ao iniciar Sentry: ${err.message}`;
    }
}

/* ----------------------------------------------------------------- Datadog */

function startDatadog() {
    if (!config.datadog.enabled || config.disabled) return;

    const tracer = optional('dd-trace');
    if (!tracer) {
        state.datadog.reason = 'dd-trace não instalado';
        return;
    }

    try {
        tracer.init({
            service: config.serviceName,
            env: config.env,
            version: config.release,
            hostname: config.datadog.agentHost,
            port: config.datadog.agentPort,
            sampleRate: config.tracesSampleRate,
            logInjection: true,
            // O corpo e a query podem conter CPF; o dd-trace não os coleta por
            // padrão, e nada aqui reativa isso.
        });

        state.datadog.client = tracer;
        state.datadog.active = true;
    } catch (err) {
        state.datadog.reason = `falha ao iniciar Datadog: ${err.message}`;
    }
}

/* ---------------------------------------------------------------- New Relic */

function startNewRelic() {
    if (!config.newrelic.enabled || config.disabled) return;

    // O agente do New Relic precisa ser o PRIMEIRO require do processo para
    // instrumentar corretamente. Quando ligado, prefira o preload:
    //     node -r newrelic src/index.js
    // O require aqui é o caminho de contingência.
    const newrelic = optional('newrelic');
    if (!newrelic) {
        state.newrelic.reason = 'newrelic não instalado';
        return;
    }

    state.newrelic.client = newrelic;
    state.newrelic.active = true;
}

/* ------------------------------------------------------------------- API */

function startAll() {
    // Datadog e New Relic antes do Sentry: ambos fazem monkey-patch pesado.
    startDatadog();
    startNewRelic();
    startSentry();
}

/**
 * Reporta uma exceção a todos os provedores ativos.
 * @param {Error} error
 * @param {object} [context] contexto extra — passa por scrub antes de sair
 */
function captureException(error, context) {
    const { scrubObject } = require('./scrub');
    const safe = context ? scrubObject(context) : undefined;

    if (state.sentry.active) {
        try {
            state.sentry.client.withScope((scope) => {
                if (safe) scope.setContext('extra', safe);
                state.sentry.client.captureException(error);
            });
        } catch (_err) {
            /* provedor fora do ar não pode quebrar o fluxo */
        }
    }

    if (state.newrelic.active) {
        try {
            state.newrelic.client.noticeError(error, safe || {});
        } catch (_err) {
            /* idem */
        }
    }

    if (state.datadog.active) {
        try {
            const span = state.datadog.client.scope().active();
            if (span) span.setTag('error', error);
        } catch (_err) {
            /* idem */
        }
    }
}

function captureMessage(message, level = 'info', context) {
    if (!state.sentry.active) return;
    const { scrubObject, sanitize } = require('./scrub');
    try {
        state.sentry.client.withScope((scope) => {
            scope.setLevel(level);
            if (context) scope.setContext('extra', scrubObject(context));
            state.sentry.client.captureMessage(sanitize(String(message)));
        });
    } catch (_err) {
        /* silencioso por design */
    }
}

/**
 * Identidade do usuário para agrupar eventos.
 * Só ID, perfil e escola — nunca nome, e-mail ou documento.
 */
function setUser(user) {
    if (!user) return;
    const identity = {
        id: String(user.id || user._id || ''),
        perfil: user.perfil || user.role,
        escolaId: user.escolaId ? String(user.escolaId) : undefined,
    };

    if (state.sentry.active) {
        try {
            state.sentry.client.setUser(identity);
        } catch (_err) {
            /* noop */
        }
    }
    if (state.newrelic.active) {
        try {
            state.newrelic.client.addCustomAttributes(identity);
        } catch (_err) {
            /* noop */
        }
    }
}

function status() {
    return {
        sentry: { active: state.sentry.active, reason: state.sentry.reason },
        datadog: { active: state.datadog.active, reason: state.datadog.reason },
        newrelic: { active: state.newrelic.active, reason: state.newrelic.reason },
    };
}

async function shutdown() {
    if (state.sentry.active) {
        try {
            // Dá 2s para despachar o que estiver na fila antes do processo sair.
            await state.sentry.client.close(2000);
        } catch (_err) {
            /* best-effort */
        }
    }
}

module.exports = {
    startAll,
    captureException,
    captureMessage,
    setUser,
    status,
    shutdown,
    get sentry() {
        return state.sentry.active ? state.sentry.client : null;
    },
};
