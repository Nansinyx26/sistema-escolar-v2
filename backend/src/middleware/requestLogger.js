/**
 * requestLogger.js — Métricas HTTP + escopo de contexto de log
 *
 * Duas responsabilidades:
 *   1. Abre o escopo do AsyncLocalStorage para a requisição. A partir daqui,
 *      QUALQUER `logger.*()` chamado na pilha — controller, service, model —
 *      sai carimbado com requestId/userId/escolaId sem receber `req`.
 *   2. Registra a linha de acesso no `finish` (status, duração, tamanho) e
 *      dispara alertas para 5xx e requisições lentas.
 *
 * Ordem em app.js: este middleware precisa vir ANTES das rotas e do authJWT,
 * para que o contexto já exista quando o auth preencher o userId.
 */

const logger = require('../utils/logger');
const logContext = require('../utils/logContext');
const monitoring = require('../services/MonitoringService');

/** Duração em ms com relógio monotônico (imune a ajuste de hora do sistema). */
function getDurationMs(start) {
    const diff = process.hrtime(start);
    return Math.round((diff[0] * 1e3) + (diff[1] / 1e6));
}

function requestLogger(req, res, next) {
    // Health checks e assets não geram linha de acesso (ruído puro), mas ainda
    // assim recebem contexto — um erro dentro deles precisa ser rastreável.
    const skipPaths = ['/api/health', '/api/ping', '/favicon'];
    const silent = skipPaths.some(p => req.path.startsWith(p));

    const start = process.hrtime();
    const requestId = logContext.generateRequestId();

    req.requestId = requestId;
    // Devolve o id ao cliente: um usuário que reporta erro traz o id do incidente.
    res.setHeader('X-Request-Id', requestId);

    const baseContext = {
        requestId,
        method: req.method,
        path: req.originalUrl || req.url,
    };

    logContext.run(baseContext, () => {
        res.on('finish', () => {
            if (silent) return;

            const durationMs = getDurationMs(start);
            const statusCode = res.statusCode;

            monitoring.recordRequest(statusCode, durationMs);

            const clientIp = String(
                req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress || '0.0.0.0'
            ).split(',')[0].trim();

            const meta = {
                status: statusCode,
                durationMs,
                contentLength: Number(res.getHeader('content-length') || 0),
                ip: clientIp,
                userAgent: String(req.headers['user-agent'] || '').substring(0, 120),
            };
            // requestId/userId/escolaId entram sozinhos pelo contexto — não repetir aqui.

            const line = `${req.method} ${req.originalUrl} → ${statusCode} (${durationMs}ms)`;

            if (statusCode >= 500) {
                logger.error(line, meta);
                logger.alert('HTTP_5XX', `Erro ${statusCode} em ${req.method} ${req.originalUrl}`, meta);
            } else if (statusCode >= 400) {
                logger.warn(line, meta);
            } else {
                logger.info(line, meta);
            }

            if (durationMs > 5000) {
                logger.alert('SLOW_REQUEST', `Requisição lenta em ${req.method} ${req.originalUrl}`, {
                    durationMs, threshold: 5000,
                });
            }
        });

        next();
    });
}

module.exports = { requestLogger };
