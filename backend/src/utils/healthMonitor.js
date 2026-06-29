/**
 * healthMonitor.js — Monitor de Saúde do Sistema (Roadmap #6 — Observabilidade)
 *
 * Verifica periodicamente:
 *   - Conexão com o MongoDB
 *   - Uso de memória do processo Node.js
 *   - Uptime do servidor
 *
 * Emite alertas automáticos via logger quando detecta anomalias.
 *
 * Uso:
 *   const { startHealthMonitor } = require('./utils/healthMonitor');
 *   startHealthMonitor();   // Inicia verificação periódica
 */

const mongoose = require('mongoose');
const logger = require('./logger');

// Intervalo de verificação: 2 minutos
const CHECK_INTERVAL_MS = 2 * 60 * 1000;

// Limite de memória para alerta (512MB)
const MEMORY_THRESHOLD_MB = 512;

// Rastreia estado anterior do banco para detectar transições
let _lastDbState = null;

/**
 * Verifica a saúde do MongoDB.
 * Estados possíveis: 0=disconnected, 1=connected, 2=connecting, 3=disconnecting
 */
function checkDatabase() {
    const state = mongoose.connection.readyState;
    const stateNames = { 0: 'disconnected', 1: 'connected', 2: 'connecting', 3: 'disconnecting' };
    const stateName = stateNames[state] || 'unknown';

    if (state !== 1) {
        logger.alert('DB_DOWN', `MongoDB não está conectado (estado: ${stateName})`, {
            service: 'mongodb',
            readyState: state,
            stateName,
        });
    } else if (_lastDbState !== null && _lastDbState !== 1) {
        // Banco voltou ao normal após uma falha
        logger.info('✅ MongoDB reconectado com sucesso', {
            service: 'mongodb',
            previousState: _lastDbState,
        });
    }

    _lastDbState = state;
    return { state, stateName, healthy: state === 1 };
}

/**
 * Verifica o uso de memória do processo Node.js.
 */
function checkMemory() {
    const usage = process.memoryUsage();
    const heapUsedMB = Math.round(usage.heapUsed / 1024 / 1024);
    const heapTotalMB = Math.round(usage.heapTotal / 1024 / 1024);
    const rssMB = Math.round(usage.rss / 1024 / 1024);
    const externalMB = Math.round((usage.external || 0) / 1024 / 1024);

    if (heapUsedMB > MEMORY_THRESHOLD_MB) {
        logger.alert('HIGH_MEMORY', `Uso elevado de heap: ${heapUsedMB}MB (limite: ${MEMORY_THRESHOLD_MB}MB)`, {
            heapUsedMB,
            heapTotalMB,
            rssMB,
            threshold: MEMORY_THRESHOLD_MB,
        });
    }

    return { heapUsedMB, heapTotalMB, rssMB, externalMB };
}

/**
 * Coleta o uptime do processo.
 */
function getUptime() {
    const seconds = Math.floor(process.uptime());
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    return {
        totalSeconds: seconds,
        formatted: `${hours}h ${minutes}m ${secs}s`,
    };
}

/**
 * Executa uma verificação completa de saúde e loga o resultado.
 */
function runHealthCheck() {
    const db = checkDatabase();
    const memory = checkMemory();
    const uptime = getUptime();

    logger.debug('🩺 Health check executado', {
        db: db.stateName,
        memoryHeapMB: memory.heapUsedMB,
        memoryRssMB: memory.rssMB,
        uptime: uptime.formatted,
    });

    return { db, memory, uptime, timestamp: new Date().toISOString() };
}

/**
 * Inicia o monitor de saúde com verificações periódicas.
 */
function startHealthMonitor() {
    logger.info('🩺 Health Monitor iniciado', {
        intervalMs: CHECK_INTERVAL_MS,
        memoryThresholdMB: MEMORY_THRESHOLD_MB,
    });

    // Primeira verificação após 30 segundos (dá tempo do servidor estabilizar)
    setTimeout(() => {
        runHealthCheck();
        // Verificações periódicas
        setInterval(runHealthCheck, CHECK_INTERVAL_MS);
    }, 30_000);
}

module.exports = { startHealthMonitor, runHealthCheck };
