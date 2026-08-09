/**
 * observability/otel.js — OpenTelemetry, a base vendor-neutral.
 *
 * Por que OTel é a base e não mais um provedor: traces em OTLP saem daqui para
 * Datadog, New Relic, Grafana, Honeycomb ou qualquer coletor, sem reescrever
 * instrumentação. Trocar de fornecedor vira mudança de variável de ambiente.
 *
 * IMPORTANTE: precisa ser inicializado ANTES de `express`, `mongoose` e `http`
 * serem requeridos — as instrumentações funcionam por monkey-patch dos módulos.
 * Por isso `src/index.js` chama `observability.init()` na primeira linha.
 *
 * Os pacotes @opentelemetry/* são OPCIONAIS. Se não estiverem instalados, esta
 * camada apenas não liga e o servidor sobe normalmente.
 */

const config = require('./config');

let sdk = null;
let started = false;
let unavailableReason = null;

/**
 * Requer um módulo opcional. Devolve null (com motivo registrado) em vez de
 * estourar, para que a ausência do SDK nunca derrube o boot do servidor.
 */
function optional(moduleName) {
    try {
        return require(moduleName);
    } catch (err) {
        if (err && err.code === 'MODULE_NOT_FOUND') return null;
        throw err;
    }
}

function start() {
    if (started || !config.otel.enabled || config.disabled) return false;

    const sdkNode = optional('@opentelemetry/sdk-node');
    const resources = optional('@opentelemetry/resources');
    const semconv = optional('@opentelemetry/semantic-conventions');
    const autoInst = optional('@opentelemetry/auto-instrumentations-node');
    const otlpTrace = optional('@opentelemetry/exporter-trace-otlp-http');

    if (!sdkNode || !resources || !autoInst) {
        unavailableReason = 'pacotes @opentelemetry/* não instalados — rode: npm run obs:install';
        return false;
    }

    try {
        const { NodeSDK } = sdkNode;
        const { getNodeAutoInstrumentations } = autoInst;

        const attrs = {};
        const ATTR = semconv || {};
        attrs[ATTR.ATTR_SERVICE_NAME || 'service.name'] = config.serviceName;
        attrs[ATTR.ATTR_SERVICE_VERSION || 'service.version'] = config.release;
        attrs['deployment.environment'] = config.env;

        const resource =
            typeof resources.resourceFromAttributes === 'function'
                ? resources.resourceFromAttributes(attrs)
                : new resources.Resource(attrs);

        const traceExporter = otlpTrace
            ? new otlpTrace.OTLPTraceExporter({
                  url: `${config.otel.endpoint.replace(/\/$/, '')}/v1/traces`,
                  headers: parseHeaders(config.otel.headers),
              })
            : undefined;

        sdk = new NodeSDK({
            resource,
            traceExporter,
            instrumentations: [
                getNodeAutoInstrumentations({
                    // Ruído puro: cada leitura de arquivo estático viraria span.
                    '@opentelemetry/instrumentation-fs': { enabled: false },
                    '@opentelemetry/instrumentation-http': {
                        // Health check a cada poucos segundos afogaria o trace.
                        ignoreIncomingRequestHook(req) {
                            const url = req.url || '';
                            return (
                                url.startsWith('/health') ||
                                url.startsWith('/api/health') ||
                                url.startsWith('/favicon')
                            );
                        },
                    },
                }),
            ],
        });

        sdk.start();
        started = true;
        return true;
    } catch (err) {
        unavailableReason = `falha ao iniciar OTel: ${err.message}`;
        return false;
    }
}

function parseHeaders(raw) {
    // Formato padrão OTEL_EXPORTER_OTLP_HEADERS: "chave=valor,chave2=valor2"
    if (!raw) return undefined;
    const out = {};
    String(raw)
        .split(',')
        .forEach((pair) => {
            const idx = pair.indexOf('=');
            if (idx > 0) out[pair.slice(0, idx).trim()] = pair.slice(idx + 1).trim();
        });
    return Object.keys(out).length ? out : undefined;
}

/**
 * Executa uma função dentro de um span. Vira no-op sem o SDK, então o call site
 * fica idêntico esteja o OTel ligado ou não.
 *
 *   await withSpan('matricula.criar', { escolaId }, async (span) => { ... });
 */
async function withSpan(name, attributes, fn) {
    if (typeof attributes === 'function') {
        fn = attributes;
        attributes = {};
    }

    const api = optional('@opentelemetry/api');
    if (!api || !started) {
        return fn({ setAttribute() {}, addEvent() {}, recordException() {} });
    }

    const tracer = api.trace.getTracer(config.serviceName, config.release);

    return tracer.startActiveSpan(name, { attributes }, async (span) => {
        try {
            const result = await fn(span);
            span.setStatus({ code: api.SpanStatusCode.OK });
            return result;
        } catch (err) {
            span.recordException(err);
            span.setStatus({ code: api.SpanStatusCode.ERROR, message: err.message });
            throw err;
        } finally {
            span.end();
        }
    });
}

/** Anexa atributos ao span ativo, se houver. */
function annotate(attributes) {
    const api = optional('@opentelemetry/api');
    if (!api || !started) return;
    const span = api.trace.getActiveSpan();
    if (span && attributes) span.setAttributes(attributes);
}

/** ID do trace atual — útil para correlacionar log e erro exibido ao usuário. */
function currentTraceId() {
    const api = optional('@opentelemetry/api');
    if (!api || !started) return null;
    const span = api.trace.getActiveSpan();
    if (!span) return null;
    const ctx = span.spanContext();
    return ctx?.traceId ? ctx.traceId : null;
}

async function shutdown() {
    if (!sdk || !started) return;
    try {
        await sdk.shutdown();
    } catch (_err) {
        // Encerramento é best-effort: não impedir o processo de sair.
    } finally {
        started = false;
    }
}

module.exports = {
    start,
    shutdown,
    withSpan,
    annotate,
    currentTraceId,
    get started() {
        return started;
    },
    get unavailableReason() {
        return unavailableReason;
    },
};
