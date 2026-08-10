/**
 * observability/index.js — ponto único de entrada da observabilidade.
 *
 * Todo código do sistema fala com este módulo, nunca direto com Sentry,
 * Datadog, New Relic ou OpenTelemetry. Assim trocar de provedor é mexer aqui,
 * não em 200 call sites.
 *
 * USO
 *
 *   // src/index.js — PRIMEIRA linha do processo
 *   require('./observability').init();
 *
 *   // em qualquer serviço
 *   const obs = require('../observability');
 *
 *   await obs.withSpan('matricula.criar', { escolaId }, async (span) => {
 *       span.setAttribute('turma', turmaId);
 *       return Matricula.create(dados);
 *   });
 *
 *   obs.captureException(err, { rota: 'POST /api/matriculas' });
 *
 * Ver docs/OBSERVABILITY.md.
 */

const config = require('./config');
const otel = require('./otel');
const providers = require('./providers');
// `summary`/`status` vivem em módulo separado para o middleware poder lê-los
// sem requerer este arquivo de volta — ver o cabeçalho de status.js.
const { summary, status } = require('./status');

let initialized = false;

/**
 * Inicializa a observabilidade. Idempotente.
 * Precisa rodar ANTES de express/mongoose serem requeridos.
 * @returns {{enabled: boolean, providers: string[]}}
 */
function init() {
    if (initialized) return summary();
    initialized = true;

    if (config.disabled) return summary();

    // OTel primeiro: as instrumentações precisam patchear os módulos antes de
    // qualquer outro require de http/express/mongoose.
    otel.start();
    providers.startAll();

    // Nada aqui pode derrubar o processo. Um erro não tratado que chegue neste
    // ponto é reportado e o comportamento padrão do Node segue valendo.
    process.on('uncaughtException', (err) => {
        providers.captureException(err, { tipo: 'uncaughtException' });
    });

    process.on('unhandledRejection', (reason) => {
        const err = reason instanceof Error ? reason : new Error(String(reason));
        providers.captureException(err, { tipo: 'unhandledRejection' });
    });

    return summary();
}

/** Encerramento gracioso — despacha o que estiver em fila. */
async function shutdown() {
    await Promise.allSettled([otel.shutdown(), providers.shutdown()]);
}

module.exports = {
    init,
    status,
    summary,
    shutdown,

    // Tracing
    withSpan: otel.withSpan,
    annotate: otel.annotate,
    currentTraceId: otel.currentTraceId,

    // Erros e eventos
    captureException: providers.captureException,
    captureMessage: providers.captureMessage,
    setUser: providers.setUser,

    // Middlewares do Express
    get middleware() {
        return require('./middleware');
    },

    config,
};
