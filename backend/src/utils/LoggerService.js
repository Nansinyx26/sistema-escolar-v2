/**
 * LoggerService — DEPRECIADO. Use `require('./utils/logger')`.
 *
 * Este módulo era um segundo logger paralelo ao `utils/logger.js`. Manter dois
 * era um problema real de observabilidade: metade dos eventos saía em um
 * formato e destino, metade em outro, e nenhum dos dois tinha a história
 * completa de uma requisição.
 *
 * Problemas concretos da implementação anterior, agora eliminados:
 *   • `fs.appendFileSync` a cada log — I/O síncrono bloqueando o event loop
 *     no caminho quente das requisições.
 *   • Escrita em `backend/logs/` — disco efêmero no Render: os arquivos somem
 *     a cada deploy, então o custo era pago sem nenhum benefício.
 *   • Nenhuma sanitização: senhas e PII iam cruas para o arquivo.
 *
 * Este arquivo virou um adaptador fino sobre o logger unificado, para que
 * qualquer `require` remanescente continue funcionando. Não escreva código
 * novo contra ele.
 */

'use strict';

const logger = require('./logger');

module.exports = {
    trace: (msg, meta = {}) => logger.debug(msg, meta),
    debug: (msg, meta = {}) => logger.debug(msg, meta),
    info: (msg, meta = {}) => logger.info(msg, meta),
    warn: (msg, meta = {}) => logger.warn(msg, meta),
    error: (msg, error = null, meta = {}) => logger.error(msg, error, meta),
    fatal: (msg, error = null, meta = {}) => logger.fatal(msg, error, meta),

    logQuery: (collection, operation, duration, success = true) =>
        logger[success ? 'debug' : 'warn'](`DB ${operation} ${collection}`, {
            collection, operation, durationMs: duration, success,
        }),

    logSlowQuery: (collection, operation, duration) => {
        if (duration > 100) {
            logger.warn(`Query lenta: ${operation} ${collection}`, {
                collection, operation, durationMs: duration,
            });
        }
    },

    /** O logging HTTP agora é do `middleware/requestLogger`, que também abre o contexto. */
    httpMiddleware: (req, res, next) => next(),

    /** Os logs vão para stdout/stderr e são coletados pela plataforma. */
    getLogFile: () => 'Logs agora vão para stdout/stderr — consulte o agregador da plataforma.',
    cleanOldLogs: () => {},
    health: () => ({ ok: true, engine: logger._engine }),
};
