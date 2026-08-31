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

// Enquanto verdadeiro, os handlers abaixo reproduzem a saída padrão do Node que
// o próprio registro deles suprimiu. O `src/index.js` desarma com
// `assumirEncerramento()` ao assumir a política. Ver Issue #129.
let saidaPadraoArmada = false;

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

    // ATENÇÃO (Issue #129): registrar listener nestes dois eventos SUBSTITUI o
    // comportamento padrão do Node, não o preserva.
    //
    //   uncaughtException  — sem listener, o Node imprime o stack e sai com 1.
    //                        COM listener, ele não sai: o processo segue
    //                        rodando, possivelmente em estado inconsistente.
    //   unhandledRejection — desde o Node 15 o padrão é derrubar o processo.
    //                        Um listener registrado suprime isso.
    //
    // O comentário que estava aqui afirmava o contrário ("o comportamento
    // padrão do Node segue valendo"), e é o tipo de coisa que se lê e não se
    // questiona.
    //
    // Quem é dono da política de encerramento é o `src/index.js`, que registra
    // os próprios handlers DEPOIS de `app.listen`. Entre `observability.init()`
    // (primeira linha do processo) e esse ponto passam `connectDB`, o cache, as
    // migrações e o alinhamento de retenção — uma janela inteira de boot em que
    // só o listener daqui existiria. Com a observabilidade ligada, uma exceção
    // nessa janela seria reportada e ENGOLIDA, e o boot continuaria a partir de
    // um passo que falhou.
    //
    // Por isso a saída padrão fica ARMADA aqui e o `index.js` a desarma com
    // `assumirEncerramento()` quando assume o posto. Não é o registro dos
    // handlers que se move: é a responsabilidade que troca de mãos num ponto
    // explícito, em vez de depender da ordem em que dois arquivos rodam.
    saidaPadraoArmada = true;

    process.on('uncaughtException', (err) => {
        providers.captureException(err, { tipo: 'uncaughtException' });
        if (saidaPadraoArmada) encerrarComoNodeFaria(err, 'uncaughtException');
    });

    process.on('unhandledRejection', (reason) => {
        const err = reason instanceof Error ? reason : new Error(String(reason));
        providers.captureException(err, { tipo: 'unhandledRejection' });
        if (saidaPadraoArmada) encerrarComoNodeFaria(err, 'unhandledRejection');
    });

    return summary();
}

/**
 * Reproduz o que o Node faria se ninguém tivesse registrado listener: imprime
 * o erro em stderr e sai com 1.
 *
 * `stderr` direto, e não o logger: este caminho existe justamente para o
 * intervalo em que o boot pode não ter terminado, e uma exceção aqui não pode
 * depender de nenhum módulo ter subido.
 */
function encerrarComoNodeFaria(err, tipo) {
    try {
        process.stderr.write(`[observability] ${tipo} sem dono da política de encerramento\n`);
        process.stderr.write(`${err?.stack || err}\n`);
    } catch (_) {
        // stderr fechado: não há mais o que fazer além de sair.
    }
    process.exit(1);
}

/**
 * O `src/index.js` chama isto quando registra os próprios handlers de
 * `uncaughtException`/`unhandledRejection`. A partir daqui a observabilidade
 * volta a só REPORTAR — a decisão de encerrar (e o prazo dela) é de lá.
 *
 * Ver docs/OBSERVABILITY.md, "Quem é dono do encerramento do processo".
 */
function assumirEncerramento() {
    saidaPadraoArmada = false;
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
    assumirEncerramento,

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
