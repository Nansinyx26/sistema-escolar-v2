/**
 * observability/config.js — leitura e validação das variáveis de ambiente.
 *
 * Princípio: TUDO desligado por padrão. Um provedor só liga quando a sua
 * variável de habilitação está em "true" E a credencial correspondente existe.
 * Assim nenhum ambiente (dev, teste, CI) passa a mandar dado para fora por
 * acidente, e a ausência de credencial nunca derruba o boot.
 */

function flag(name, fallback = false) {
    const raw = process.env[name];
    if (raw === undefined || raw === '') return fallback;
    return /^(1|true|yes|on)$/i.test(String(raw).trim());
}

function num(name, fallback) {
    const raw = Number(process.env[name]);
    return Number.isFinite(raw) ? raw : fallback;
}

const NODE_ENV = process.env.NODE_ENV || 'development';
const IS_TEST = NODE_ENV === 'test';

const config = {
    env: NODE_ENV,
    serviceName: process.env.OTEL_SERVICE_NAME || 'sistema-escolar-backend',
    // O CI/CD cria release v<run_number>; o Render expõe o SHA do commit.
    release:
        process.env.RELEASE_VERSION ||
        process.env.RENDER_GIT_COMMIT ||
        process.env.GITHUB_SHA ||
        'dev',

    // Em teste nada é inicializado, mesmo com env ligada — senão a suíte
    // passaria a depender de rede e a poluir os provedores com dado falso.
    disabled: IS_TEST || flag('OBSERVABILITY_DISABLED', false),

    /** Amostragem de traces. Em produção 10% costuma bastar e segura custo. */
    tracesSampleRate: num('OTEL_TRACES_SAMPLE_RATE', NODE_ENV === 'production' ? 0.1 : 1.0),

    otel: {
        enabled: flag('OTEL_ENABLED', false),
        endpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT || 'http://localhost:4318',
        headers: process.env.OTEL_EXPORTER_OTLP_HEADERS || '',
        // Sem endpoint configurado o exporter fica só no console (útil em dev).
        consoleFallback: flag('OTEL_CONSOLE_EXPORTER', false),
    },

    sentry: {
        enabled: flag('SENTRY_ENABLED', false) && !!process.env.SENTRY_DSN,
        dsn: process.env.SENTRY_DSN || '',
        // Sentry só faz sentido com amostragem própria de performance.
        profilesSampleRate: num('SENTRY_PROFILES_SAMPLE_RATE', 0),
    },

    datadog: {
        enabled: flag('DATADOG_ENABLED', false) && !!process.env.DD_API_KEY,
        site: process.env.DD_SITE || 'datadoghq.com',
        agentHost: process.env.DD_AGENT_HOST || 'localhost',
        agentPort: num('DD_TRACE_AGENT_PORT', 8126),
    },

    newrelic: {
        enabled: flag('NEWRELIC_ENABLED', false) && !!process.env.NEW_RELIC_LICENSE_KEY,
        appName: process.env.NEW_RELIC_APP_NAME || 'sistema-escolar-backend',
    },
};

/** Provedores efetivamente ligados — usado pelo endpoint de health. */
config.activeProviders = function activeProviders() {
    if (config.disabled) return [];
    return ['otel', 'sentry', 'datadog', 'newrelic'].filter((name) => config[name].enabled);
};

module.exports = config;
