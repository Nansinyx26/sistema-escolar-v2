/**
 * requestLogger.js — Middleware de Métricas HTTP (Roadmap #6 — Observabilidade)
 *
 * Registra cada requisição HTTP com:
 *   - Método, rota, status code, duração (ms)
 *   - Tamanho da resposta, IP do cliente
 *   - Alertas automáticos para erros 5xx e requisições lentas
 *
 * Uso em app.js:
 *   const { requestLogger } = require('./middleware/requestLogger');
 *   app.use(requestLogger);
 */

const logger = require('../utils/logger');
const monitoring = require('../services/MonitoringService');

/**
 * Calcula a duração da requisição usando process.hrtime.
 */
function getDurationMs(start) {
    const diff = process.hrtime(start);
    return Math.round((diff[0] * 1e3) + (diff[1] / 1e6));
}

/**
 * Middleware principal de logging de requisições.
 */
function requestLogger(req, res, next) {
    // Ignora health checks e assets estáticos para não poluir os logs
    const skipPaths = ['/api/health', '/api/ping', '/favicon'];
    if (skipPaths.some(p => req.path.startsWith(p))) {
        return next();
    }

    const start = process.hrtime();
    const requestId = generateRequestId();

    // Injeta o requestId no objeto req para rastreabilidade nos controllers
    req.requestId = requestId;

    // Captura o evento 'finish' da resposta para logar métricas finais
    res.on('finish', () => {
        const durationMs = getDurationMs(start);
        const statusCode = res.statusCode;

        // Registrar métricas no serviço de monitoramento
        monitoring.recordRequest(statusCode, durationMs);
        const contentLength = res.getHeader('content-length') || 0;

        // Extrai o IP real (respeitando proxy reverso do Render)
        const clientIp = (req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress || '0.0.0.0')
            .split(',')[0].trim();

        const meta = {
            requestId,
            method: req.method,
            path: req.originalUrl || req.url,
            status: statusCode,
            durationMs,
            contentLength: Number(contentLength),
            ip: clientIp,
            userAgent: req.headers['user-agent']?.substring(0, 120),
        };

        // Adiciona identificação do usuário autenticado (se disponível)
        if (req.user) {
            meta.userId = req.user.id || req.user._id;
            meta.userPerfil = req.user.perfil;
        }

        // Nível do log baseado no status code
        if (statusCode >= 500) {
            logger.error(`${req.method} ${req.originalUrl} → ${statusCode} (${durationMs}ms)`, meta);

            // Alerta automático para erros 5xx
            logger.alert('HTTP_5XX', `Erro ${statusCode} em ${req.method} ${req.originalUrl}`, {
                requestId,
                method: req.method,
                path: req.originalUrl,
                status: statusCode,
                durationMs,
            });

        } else if (statusCode >= 400) {
            logger.warn(`${req.method} ${req.originalUrl} → ${statusCode} (${durationMs}ms)`, meta);

        } else {
            logger.info(`${req.method} ${req.originalUrl} → ${statusCode} (${durationMs}ms)`, meta);
        }

        // Alerta para requisições muito lentas (> 5 segundos)
        if (durationMs > 5000) {
            logger.alert('SLOW_REQUEST', `Requisição lenta: ${durationMs}ms em ${req.method} ${req.originalUrl}`, {
                requestId,
                durationMs,
                threshold: 5000,
            });
        }
    });

    next();
}

/**
 * Gera um ID único curto para rastrear requisições nos logs.
 * Formato: 8 caracteres hexadecimais (ex: "a3f8b2c1")
 */
function generateRequestId() {
    return Math.random().toString(16).substring(2, 10);
}

module.exports = { requestLogger };
