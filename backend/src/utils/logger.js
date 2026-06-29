/**
 * logger.js — Sistema de Logs Estruturados (Roadmap #6 — Observabilidade)
 *
 * Logger centralizado para o backend do Sistema Escolar.
 * Produz logs em formato JSON estruturado em produção e formato legível em desenvolvimento.
 *
 * Níveis: DEBUG < INFO < WARN < ERROR < FATAL
 *
 * Uso:
 *   const logger = require('./utils/logger');
 *   logger.info('Servidor iniciado', { port: 3001 });
 *   logger.error('Falha ao conectar', { service: 'mongodb', err: error.message });
 */

const LEVELS = { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3, FATAL: 4 };

const LOG_LEVEL = LEVELS[(process.env.LOG_LEVEL || 'DEBUG').toUpperCase()] || LEVELS.DEBUG;
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

/**
 * Formata e imprime uma entrada de log.
 * Em produção: JSON de linha única (compatível com Render, Datadog, etc.).
 * Em desenvolvimento: formato colorido e legível.
 */
function emit(level, message, meta = {}) {
    if (LEVELS[level] < LOG_LEVEL) return;

    const entry = {
        timestamp: new Date().toISOString(),
        level,
        message,
        ...meta
    };

    if (IS_PRODUCTION) {
        // JSON estruturado — uma linha por log (ideal para agregadores)
        const stream = LEVELS[level] >= LEVELS.ERROR ? process.stderr : process.stdout;
        stream.write(JSON.stringify(entry) + '\n');
    } else {
        // Formato legível para desenvolvimento
        const colors = {
            DEBUG: '\x1b[36m',   // Ciano
            INFO:  '\x1b[32m',   // Verde
            WARN:  '\x1b[33m',   // Amarelo
            ERROR: '\x1b[31m',   // Vermelho
            FATAL: '\x1b[35m',   // Magenta
        };
        const reset = '\x1b[0m';
        const color = colors[level] || reset;
        const ts = entry.timestamp.replace('T', ' ').replace('Z', '');

        const metaKeys = Object.keys(meta);
        const metaStr = metaKeys.length > 0
            ? ` ${JSON.stringify(meta)}`
            : '';

        const stream = LEVELS[level] >= LEVELS.ERROR ? process.stderr : process.stdout;
        stream.write(`${color}[${ts}] [${level}]${reset} ${message}${metaStr}\n`);
    }
}

/**
 * Armazena alertas recentes para evitar spam de notificações.
 * Chave: fingerprint do alerta → valor: timestamp do último disparo.
 */
const _alertCooldowns = new Map();
const ALERT_COOLDOWN_MS = 5 * 60 * 1000; // 5 minutos entre alertas iguais

/**
 * Dispara um alerta estruturado para falhas críticas.
 * Inclui deduplicação por cooldown para evitar log flooding.
 *
 * @param {string} type  - Tipo do alerta (ex: 'DB_DOWN', 'UNHANDLED_REJECTION', 'HTTP_5XX')
 * @param {string} message - Descrição do problema
 * @param {Object} context - Metadados adicionais
 */
function alert(type, message, context = {}) {
    const fingerprint = `${type}:${message}`;
    const now = Date.now();
    const last = _alertCooldowns.get(fingerprint);

    if (last && (now - last) < ALERT_COOLDOWN_MS) {
        return; // Suprime alerta duplicado dentro do cooldown
    }
    _alertCooldowns.set(fingerprint, now);

    // Limpa entradas antigas do mapa para evitar memory leak
    if (_alertCooldowns.size > 500) {
        for (const [key, ts] of _alertCooldowns) {
            if (now - ts > ALERT_COOLDOWN_MS * 2) _alertCooldowns.delete(key);
        }
    }

    emit('FATAL', `🚨 [ALERTA: ${type}] ${message}`, {
        alertType: type,
        severity: 'critical',
        ...context
    });
}

const logger = {
    debug: (msg, meta) => emit('DEBUG', msg, meta),
    info:  (msg, meta) => emit('INFO', msg, meta),
    warn:  (msg, meta) => emit('WARN', msg, meta),
    error: (msg, meta) => emit('ERROR', msg, meta),
    fatal: (msg, meta) => emit('FATAL', msg, meta),
    alert,
};

module.exports = logger;
