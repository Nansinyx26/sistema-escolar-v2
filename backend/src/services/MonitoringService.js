/**
 * Monitoring Service — P3 Implementation
 * 
 * Health checks, métricas e alertas
 * Integra com Prometheus, Grafana, ou alertas simples
 * 
 * @module MonitoringService
 * @version 1.0
 */

const os = require('os');
const mongoose = require('mongoose');
const { CacheService } = require('./CacheService');
const logger = require('../utils/LoggerService');

class MonitoringService {
  constructor() {
    this.metrics = {
      requests: 0,
      errors: 0,
      avgResponseTime: 0,
      uptime: process.uptime(),
    };

    this.alerts = [];
    this.thresholds = {
      errorRate: 0.05, // 5%
      responseTime: 500, // ms
      memoryUsage: 0.9, // 90%
      dbConnectionPool: 0.8, // 80%
    };
  }

  /**
   * Health check completo
   */
  async health() {
    try {
      const [dbHealth, cacheHealth, systemHealth] = await Promise.all([
        this.checkDatabase(),
        this.checkCache(),
        this.checkSystem(),
      ]);

      const allHealthy = [dbHealth, cacheHealth, systemHealth].every(h => h.ok);

      return {
        ok: allHealthy,
        status: allHealthy ? 'healthy' : 'unhealthy',
        timestamp: new Date(),
        database: dbHealth,
        cache: cacheHealth,
        system: systemHealth,
        metrics: this.metrics,
        alerts: this.alerts,
      };
    } catch (error) {
      logger.error('Health check failed:', error);
      return {
        ok: false,
        status: 'error',
        error: error.message,
      };
    }
  }

  /**
   * Verificar saúde do banco de dados
   */
  async checkDatabase() {
    try {
      const startTime = Date.now();

      // Teste simples: ping
      if (mongoose.connection.readyState !== 1) {
        return {
          ok: false,
          status: 'disconnected',
          responseTime: 0,
        };
      }

      // Teste com query
      const db = mongoose.connection.db;
      await db.admin().ping();

      const responseTime = Date.now() - startTime;

      // Alertar se lento
      if (responseTime > this.thresholds.responseTime) {
        this.addAlert('DB_SLOW', `Database ping took ${responseTime}ms`, 'warning');
      }

      return {
        ok: true,
        status: 'connected',
        responseTime,
        collections: db.listCollections ? 'available' : 'unknown',
      };
    } catch (error) {
      this.addAlert('DB_ERROR', error.message, 'critical');
      logger.error('Database health check failed:', error);
      return {
        ok: false,
        status: 'error',
        error: error.message,
      };
    }
  }

  /**
   * Verificar saúde do cache
   */
  async checkCache() {
    try {
      const health = await CacheService.health();

      if (!health) {
        this.addAlert('CACHE_DOWN', 'Cache service not responding', 'warning');
      }

      return {
        ok: health,
        status: health ? 'healthy' : 'unhealthy',
        type: process.env.REDIS_URL ? 'redis' : 'node-cache',
      };
    } catch (error) {
      this.addAlert('CACHE_ERROR', error.message, 'warning');
      logger.error('Cache health check failed:', error);
      return {
        ok: false,
        status: 'error',
        error: error.message,
      };
    }
  }

  /**
   * Verificar saúde do sistema
   */
  checkSystem() {
    try {
      const uptime = process.uptime();
      const memUsage = process.memoryUsage();
      const cpuUsage = process.cpuUsage();
      const systemUptime = os.uptime();

      const memPercentage = memUsage.heapUsed / memUsage.heapTotal;
      const nodeVersion = process.version;
      const platform = os.platform();
      const cpus = os.cpus().length;

      // Alertar por uso de memória alto
      if (memPercentage > this.thresholds.memoryUsage) {
        this.addAlert(
          'HIGH_MEMORY',
          `Memory usage: ${(memPercentage * 100).toFixed(2)}%`,
          'warning'
        );
      }

      return {
        ok: memPercentage < 0.95, // Alertar se > 95%
        status: 'operational',
        memory: {
          used: Math.round(memUsage.heapUsed / 1024 / 1024) + ' MB',
          total: Math.round(memUsage.heapTotal / 1024 / 1024) + ' MB',
          percentage: (memPercentage * 100).toFixed(2) + '%',
        },
        cpu: {
          system: Math.round(cpuUsage.system / 1000) + ' ms',
          user: Math.round(cpuUsage.user / 1000) + ' ms',
        },
        uptime: {
          process: this.formatUptime(uptime),
          system: this.formatUptime(systemUptime),
        },
        environment: {
          nodeVersion,
          platform,
          cpus,
        },
      };
    } catch (error) {
      logger.error('System health check failed:', error);
      return {
        ok: false,
        status: 'error',
        error: error.message,
      };
    }
  }

  /**
   * Registrar metricás de requisição
   */
  recordRequest(statusCode, responseTime) {
    this.metrics.requests++;

    if (statusCode >= 400) {
      this.metrics.errors++;
    }

    // Calcular média móvel de tempo de resposta
    this.metrics.avgResponseTime =
      (this.metrics.avgResponseTime * (this.metrics.requests - 1) + responseTime) /
      this.metrics.requests;

    // Alertar se muitos erros
    const errorRate = this.metrics.errors / this.metrics.requests;
    if (errorRate > this.thresholds.errorRate && this.metrics.requests > 100) {
      this.addAlert(
        'HIGH_ERROR_RATE',
        `Error rate: ${(errorRate * 100).toFixed(2)}%`,
        'critical'
      );
    }
  }

  /**
   * Adicionar alerta
   */
  addAlert(code, message, severity = 'warning') {
    const alert = {
      code,
      message,
      severity,
      timestamp: new Date(),
    };

    this.alerts.push(alert);

    // Manter apenas últimos 100 alertas
    if (this.alerts.length > 100) {
      this.alerts = this.alerts.slice(-100);
    }

    // Log e notificação
    if (severity === 'critical') {
      logger.error(`[ALERT] ${code}: ${message}`);
      // TODO: Enviar notificação (email, Slack, etc)
    } else {
      logger.warn(`[ALERT] ${code}: ${message}`);
    }
  }

  /**
   * Obter alertas ativos
   */
  getActiveAlerts(severity = null) {
    let filtered = this.alerts;

    if (severity) {
      filtered = filtered.filter(a => a.severity === severity);
    }

    // Retornar últimos 20
    return filtered.slice(-20);
  }

  /**
   * Limpar alertas antigos (> 1 hora)
   */
  cleanOldAlerts() {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    this.alerts = this.alerts.filter(a => a.timestamp > oneHourAgo);
  }

  /**
   * Métricas prometheus-compatible
   */
  getPrometheusMetrics() {
    return `
# HELP app_requests_total Total requests
# TYPE app_requests_total counter
app_requests_total ${this.metrics.requests}

# HELP app_errors_total Total errors
# TYPE app_errors_total counter
app_errors_total ${this.metrics.errors}

# HELP app_response_time_avg Average response time
# TYPE app_response_time_avg gauge
app_response_time_avg ${this.metrics.avgResponseTime.toFixed(2)}

# HELP process_uptime Process uptime
# TYPE process_uptime gauge
process_uptime ${process.uptime()}

# HELP process_memory_used Memory used in bytes
# TYPE process_memory_used gauge
process_memory_used ${process.memoryUsage().heapUsed}

# HELP process_memory_total Total memory in bytes
# TYPE process_memory_total gauge
process_memory_total ${process.memoryUsage().heapTotal}
`;
  }

  /**
   * Helper: formatar uptime
   */
  formatUptime(seconds) {
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);

    return `${days}d ${hours}h ${minutes}m ${secs}s`;
  }

  startHealthCheckLoop(intervalMs = 60000) {
    this.healthCheckTimer = setInterval(async () => {
      try {
        const health = await this.health();
        
        if (!health.ok) {
          logger.warn('Health check failed', { health });
        }

        this.cleanOldAlerts();
      } catch (error) {
        logger.error('Health check loop error:', error);
      }
    }, intervalMs);
  }

  stopHealthCheckLoop() {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = null;
    }
  }
}

// Export singleton
const monitoring = new MonitoringService();

// Auto-start health check loop
monitoring.startHealthCheckLoop(60000); // 1 minuto

module.exports = monitoring;

/**
 * Exemplo de integração em app.js:
 * 
 * const monitoring = require('./services/MonitoringService');
 * 
 * // Metrics middleware
 * app.use((req, res, next) => {
 *   const startTime = Date.now();
 *   res.on('finish', () => {
 *     const duration = Date.now() - startTime;
 *     monitoring.recordRequest(res.statusCode, duration);
 *   });
 *   next();
 * });
 * 
 * // Health endpoint
 * app.get('/api/health', async (req, res) => {
 *   const health = await monitoring.health();
 *   res.status(health.ok ? 200 : 503).json(health);
 * });
 * 
 * // Prometheus metrics
 * app.get('/metrics', (req, res) => {
 *   res.type('text/plain');
 *   res.send(monitoring.getPrometheusMetrics());
 * });
 */
