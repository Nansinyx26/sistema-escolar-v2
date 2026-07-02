/**
 * Structured Logger Service — P3 Implementation
 * 
 * Logging estruturado com diferentes níveis
 * Exporta para console, arquivo e serviços externos
 * 
 * @module LoggerService
 * @version 1.0
 */

const fs = require('fs');
const path = require('path');

class LoggerService {
  constructor() {
    this.logsDir = path.join(__dirname, '../../logs');
    this.ensureLogsDir();

    this.levels = {
      TRACE: 0,
      DEBUG: 1,
      INFO: 2,
      WARN: 3,
      ERROR: 4,
      FATAL: 5,
    };

    this.colors = {
      TRACE: '\x1b[36m', // cyan
      DEBUG: '\x1b[35m', // magenta
      INFO: '\x1b[32m',  // green
      WARN: '\x1b[33m',  // yellow
      ERROR: '\x1b[31m', // red
      FATAL: '\x1b[41m', // red bg
      RESET: '\x1b[0m',
    };

    this.currentLevel = this.levels[process.env.LOG_LEVEL || 'INFO'];
  }

  /**
   * Garantir que diretório de logs existe
   */
  ensureLogsDir() {
    if (!fs.existsSync(this.logsDir)) {
      fs.mkdirSync(this.logsDir, { recursive: true });
    }
  }

  /**
   * Formatar timestamp
   */
  getTimestamp() {
    return new Date().toISOString();
  }

  /**
   * Formatar log estruturado
   */
  formatLog(level, message, meta = {}, error = null) {
    return {
      timestamp: this.getTimestamp(),
      level,
      message,
      meta,
      error: error ? {
        name: error.name,
        message: error.message,
        stack: error.stack,
      } : null,
      pid: process.pid,
      environment: process.env.NODE_ENV,
    };
  }

  /**
   * Escrever para arquivo
   */
  writeToFile(level, data) {
    try {
      const filename = path.join(this.logsDir, `${level.toLowerCase()}.log`);
      const line = JSON.stringify(data) + '\n';
      fs.appendFileSync(filename, line);
    } catch (err) {
      console.error('Erro ao escrever log:', err);
    }
  }

  /**
   * Escrever para stdout/stderr com cores
   */
  writeToConsole(level, message, meta) {
    const timestamp = this.getTimestamp();
    const color = this.colors[level];
    const reset = this.colors.RESET;

    let metaStr = '';
    if (Object.keys(meta).length > 0) {
      metaStr = ` ${JSON.stringify(meta)}`;
    }

    console.log(
      `${color}[${timestamp}] [${level}]${reset} ${message}${metaStr}`
    );
  }

  /**
   * Log TRACE (muito detalhado)
   */
  trace(message, meta = {}) {
    if (this.currentLevel > this.levels.TRACE) return;

    const log = this.formatLog('TRACE', message, meta);
    this.writeToConsole('TRACE', message, meta);
    this.writeToFile('trace', log);
  }

  /**
   * Log DEBUG (detalhado)
   */
  debug(message, meta = {}) {
    if (this.currentLevel > this.levels.DEBUG) return;

    const log = this.formatLog('DEBUG', message, meta);
    this.writeToConsole('DEBUG', message, meta);
    this.writeToFile('debug', log);
  }

  /**
   * Log INFO (informativo)
   */
  info(message, meta = {}) {
    if (this.currentLevel > this.levels.INFO) return;

    const log = this.formatLog('INFO', message, meta);
    this.writeToConsole('INFO', message, meta);
    this.writeToFile('app', log);
  }

  /**
   * Log WARN (aviso)
   */
  warn(message, meta = {}) {
    if (this.currentLevel > this.levels.WARN) return;

    const log = this.formatLog('WARN', message, meta);
    this.writeToConsole('WARN', message, meta);
    this.writeToFile('app', log);
  }

  /**
   * Log ERROR (erro)
   */
  error(message, error = null, meta = {}) {
    if (this.currentLevel > this.levels.ERROR) return;

    const log = this.formatLog('ERROR', message, meta, error);
    this.writeToConsole('ERROR', message, meta);
    this.writeToFile('error', log);

    // Enviar para serviço externo (Sentry, etc) em produção
    if (process.env.NODE_ENV === 'production' && process.env.SENTRY_DSN) {
      this.sendToExternal('error', log);
    }
  }

  /**
   * Log FATAL (crítico)
   */
  fatal(message, error = null, meta = {}) {
    const log = this.formatLog('FATAL', message, meta, error);
    this.writeToConsole('FATAL', message, meta);
    this.writeToFile('error', log);

    // Sempre enviar fatals para serviço externo
    if (process.env.SENTRY_DSN) {
      this.sendToExternal('fatal', log);
    }
  }

  /**
   * Enviar para serviço externo (Sentry, DataDog, etc)
   */
  sendToExternal(level, logData) {
    // TODO: Implementar integração com Sentry, DataDog, etc
    // Exemplo com Sentry:
    // const Sentry = require('@sentry/node');
    // if (level === 'error') {
    //   Sentry.captureException(logData.error);
    // } else if (level === 'fatal') {
    //   Sentry.captureMessage(logData.message, 'fatal');
    // }
  }

  /**
   * HTTP request logging middleware
   */
  httpMiddleware(req, res, next) {
    const startTime = Date.now();
    const originalSend = res.send;

    res.send = function(data) {
      const duration = Date.now() - startTime;
      const level = res.statusCode >= 400 ? 'WARN' : 'DEBUG';

      const log = this.formatLog(level, `HTTP ${req.method} ${req.path}`, {
        method: req.method,
        path: req.path,
        statusCode: res.statusCode,
        duration: `${duration}ms`,
        ip: req.ip,
        userAgent: req.get('user-agent'),
      });

      this.writeToFile('http', log);

      return originalSend.call(this, data);
    }.bind(this);

    next();
  }

  /**
   * Database query logging
   */
  logQuery(collection, operation, duration, success = true) {
    const level = success ? 'DEBUG' : 'WARN';
    const log = this.formatLog(level, `DB ${operation} ${collection}`, {
      collection,
      operation,
      duration: `${duration}ms`,
      success,
    });

    this.writeToFile('database', log);
  }

  /**
   * Performance warning para queries lentas
   */
  logSlowQuery(collection, operation, duration) {
    if (duration > 100) { // > 100ms
      const log = this.formatLog('WARN', `Slow query: ${operation} ${collection}`, {
        collection,
        operation,
        duration: `${duration}ms`,
      });

      this.writeToConsole('WARN', `Slow query: ${operation} on ${collection}`, {
        duration: `${duration}ms`,
      });
      this.writeToFile('performance', log);
    }
  }

  /**
   * Obter arquivo de log
   */
  getLogFile(type = 'app') {
    const filename = path.join(this.logsDir, `${type}.log`);
    try {
      return fs.readFileSync(filename, 'utf-8');
    } catch (err) {
      return `Log file ${type} not found`;
    }
  }

  /**
   * Limpar logs antigos (> 7 dias)
   */
  cleanOldLogs(daysToKeep = 7) {
    try {
      const files = fs.readdirSync(this.logsDir);
      const now = Date.now();
      const maxAge = daysToKeep * 24 * 60 * 60 * 1000;

      files.forEach(file => {
        const filepath = path.join(this.logsDir, file);
        const stat = fs.statSync(filepath);
        if (now - stat.mtimeMs > maxAge) {
          fs.unlinkSync(filepath);
          this.info(`Deleted old log: ${file}`);
        }
      });
    } catch (err) {
      this.error('Erro ao limpar logs antigos:', err);
    }
  }

  /**
   * Health check
   */
  health() {
    try {
      const testFile = path.join(this.logsDir, 'health-check.log');
      fs.writeFileSync(testFile, 'OK\n');
      fs.unlinkSync(testFile);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }
}

// Export singleton
const logger = new LoggerService();

module.exports = logger;

/**
 * Exemplo de uso:
 * 
 * const logger = require('./services/LoggerService');
 * 
 * // Info logs
 * logger.info('Servidor iniciado', { port: 3000 });
 * 
 * // Debug logs
 * logger.debug('Query executada', { query: {...} });
 * 
 * // Error logs
 * try {
 *   // algo
 * } catch (err) {
 *   logger.error('Falha na operação', err, { userId: 123 });
 * }
 * 
 * // Middleware
 * app.use((req, res, next) => logger.httpMiddleware(req, res, next));
 */
