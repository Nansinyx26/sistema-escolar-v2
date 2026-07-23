/**
 * Alert Service — P2.5 Implementation
 * 
 * Sistema de alertas para produção
 * Integra com Slack, Email, SMS
 * 
 * @module AlertService
 * @version 1.0
 */

const logger = require('../utils/LoggerService');

class AlertService {
  constructor() {
    this.channels = {
      slack: process.env.SLACK_WEBHOOK,
      email: process.env.ALERT_EMAIL,
      sms: process.env.ALERT_PHONE,
    };

    this.severities = {
      LOW: 0,
      MEDIUM: 1,
      HIGH: 2,
      CRITICAL: 3,
    };

    this.alertHistory = [];
    this.alertRules = new Map();
    this.setupDefaultRules();
  }

  /**
   * Setup regras padrão de alerta
   */
  setupDefaultRules() {
    this.addRule('database_slow', {
      condition: (metric) => metric.responseTime > 1000,
      severity: 'HIGH',
      channels: ['slack', 'email'],
      throttle: 300, // 5 min
    });

    this.addRule('error_rate_high', {
      condition: (metric) => metric.errorRate > 0.05,
      severity: 'HIGH',
      channels: ['slack'],
      throttle: 300,
    });

    this.addRule('memory_usage_high', {
      condition: (metric) => metric.memoryUsage > 0.9,
      severity: 'CRITICAL',
      channels: ['slack', 'email', 'sms'],
      throttle: 60,
    });

    this.addRule('cache_down', {
      condition: (metric) => !metric.cacheHealth,
      severity: 'HIGH',
      channels: ['slack', 'email'],
      throttle: 120,
    });

    this.addRule('database_down', {
      condition: (metric) => !metric.dbHealth,
      severity: 'CRITICAL',
      channels: ['slack', 'email', 'sms'],
      throttle: 30,
    });
  }

  /**
   * Adicionar regra personalizada
   */
  addRule(name, rule) {
    this.alertRules.set(name, {
      name,
      ...rule,
      lastTriggered: null,
    });
  }

  /**
   * Remover regra
   */
  removeRule(name) {
    this.alertRules.delete(name);
  }

  /**
   * Verificar métricas contra regras
   */
  async evaluateMetrics(metrics) {
    const triggered = [];

    for (const [name, rule] of this.alertRules.entries()) {
      try {
        const shouldAlert = rule.condition(metrics);
        
        if (shouldAlert && this.canTrigger(rule)) {
          triggered.push({
            name,
            rule,
            metrics,
          });

          // Marcar como disparado (para throttle)
          rule.lastTriggered = Date.now();
        }
      } catch (error) {
        logger.error(`Alert rule ${name} evaluation error:`, error);
      }
    }

    // Enviar alertas disparados
    for (const alert of triggered) {
      await this.sendAlert(alert);
    }

    return triggered;
  }

  /**
   * Verificar se pode disparar (throttle)
   */
  canTrigger(rule) {
    if (!rule.lastTriggered) return true;

    const timeSinceLastTrigger = Date.now() - rule.lastTriggered;
    return timeSinceLastTrigger > (rule.throttle * 1000);
  }

  /**
   * Enviar alerta para canais configurados
   */
  async sendAlert(alert) {
    try {
      const { name, rule, metrics } = alert;
      const severity = rule.severity || 'MEDIUM';

      logger.warn(`[ALERT] ${severity}: ${name}`, { metrics });

      // Enviar para cada canal
      for (const channel of rule.channels) {
        try {
          switch (channel) {
            case 'slack':
              await this.sendSlack(name, severity, metrics);
              break;
            case 'email':
              await this.sendEmail(name, severity, metrics);
              break;
            case 'sms':
              await this.sendSMS(name, severity, metrics);
              break;
          }
        } catch (error) {
          logger.error(`Failed to send alert via ${channel}:`, error);
        }
      }

      // Registrar no histórico
      this.recordAlert({
        name,
        severity,
        timestamp: new Date(),
        metrics,
      });
    } catch (error) {
      logger.error('Alert send error:', error);
    }
  }

  /**
   * Enviar para Slack
   */
  async sendSlack(name, severity, metrics) {
    if (!this.channels.slack) return;

    try {
      const colors = {
        LOW: '#36a64f',
        MEDIUM: '#ff9900',
        HIGH: '#ff6600',
        CRITICAL: '#dd0000',
      };

      const payload = {
        attachments: [
          {
            color: colors[severity],
            title: `🚨 Alert: ${name}`,
            text: `*Severity:* ${severity}`,
            fields: Object.entries(metrics)
              .slice(0, 5) // Primeiras 5 métricas
              .map(([key, value]) => ({
                title: key,
                value: String(value),
                short: true,
              })),
            ts: Math.floor(Date.now() / 1000),
          },
        ],
      };

      const response = await fetch(this.channels.slack, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        throw new Error(`Slack API error: ${response.status}`);
      }
    } catch (error) {
      logger.error('Slack alert error:', error);
      throw error;
    }
  }

  /**
   * Enviar por Email
   */
  async sendEmail(name, severity, metrics) {
    if (!this.channels.email) return;

    try {
      // TODO: Integrar com EmailService
      const EmailService = require('./EmailService');

      const html = `
        <h2>🚨 Alert: ${name}</h2>
        <p><strong>Severity:</strong> ${severity}</p>
        <p><strong>Time:</strong> ${new Date().toISOString()}</p>
        <h3>Metrics:</h3>
        <ul>
          ${Object.entries(metrics)
            .map(([key, value]) => `<li>${key}: ${value}</li>`)
            .join('')}
        </ul>
      `;

      await EmailService.send({
        to: this.channels.email,
        subject: `[${severity}] Alert: ${name}`,
        html,
      });
    } catch (error) {
      logger.error('Email alert error:', error);
      throw error;
    }
  }

  /**
   * Enviar SMS (via Twilio, etc)
   */
  async sendSMS(name, severity, metrics) {
    if (!this.channels.sms) return;

    try {
      // TODO: Integrar com Twilio ou similar
      const message = `[${severity}] Alert: ${name} - Check dashboard immediately`;

      logger.info('SMS alert would be sent:', { phone: this.channels.sms, message });
      
      // Placeholder para integração real
      // const twilio = require('twilio')(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_TOKEN);
      // await twilio.messages.create({
      //   body: message,
      //   from: process.env.TWILIO_PHONE,
      //   to: this.channels.sms,
      // });
    } catch (error) {
      logger.error('SMS alert error:', error);
      throw error;
    }
  }

  /**
   * Registrar alerta no histórico
   */
  recordAlert(alert) {
    this.alertHistory.push(alert);

    // Manter apenas últimos 1000 alertas
    if (this.alertHistory.length > 1000) {
      this.alertHistory = this.alertHistory.slice(-1000);
    }
  }

  /**
   * Obter histórico de alertas
   */
  getHistory(filter = {}) {
    let history = this.alertHistory;

    if (filter.severity) {
      history = history.filter(a => a.severity === filter.severity);
    }

    if (filter.name) {
      history = history.filter(a => a.name === filter.name);
    }

    if (filter.hours) {
      const cutoff = Date.now() - filter.hours * 60 * 60 * 1000;
      history = history.filter(a => a.timestamp > cutoff);
    }

    return history.slice(-100); // Últimos 100
  }

  /**
   * Obter alertas ativos
   */
  getActive() {
    return Array.from(this.alertRules.values())
      .filter(rule => rule.lastTriggered)
      .map(rule => ({
        name: rule.name,
        severity: rule.severity,
        lastTriggered: rule.lastTriggered,
        secondsAgo: Math.floor((Date.now() - rule.lastTriggered) / 1000),
      }));
  }

  /**
   * Limpar histórico antigo (> 7 dias)
   */
  cleanOldAlerts(daysToKeep = 7) {
    const cutoff = Date.now() - daysToKeep * 24 * 60 * 60 * 1000;
    const original = this.alertHistory.length;
    this.alertHistory = this.alertHistory.filter(a => a.timestamp > cutoff);
    logger.info(`Cleaned ${original - this.alertHistory.length} old alerts`);
  }

  /**
   * Reset de uma regra (para testing)
   */
  resetRule(name) {
    const rule = this.alertRules.get(name);
    if (rule) {
      rule.lastTriggered = null;
    }
  }

  /**
   * Get estatísticas de alertas
   */
  getStats(hours = 24) {
    const cutoff = Date.now() - hours * 60 * 60 * 1000;
    const recent = this.alertHistory.filter(a => a.timestamp > cutoff);

    const stats = {
      total: recent.length,
      bySeverity: {},
      byName: {},
    };

    recent.forEach(alert => {
      stats.bySeverity[alert.severity] = (stats.bySeverity[alert.severity] || 0) + 1;
      stats.byName[alert.name] = (stats.byName[alert.name] || 0) + 1;
    });

    return stats;
  }
}

// Export singleton
const alertService = new AlertService();

module.exports = alertService;

/**
 * Exemplo de integração em app.js:
 * 
 * const alertService = require('./services/AlertService');
 * const monitoring = require('./services/MonitoringService');
 * 
 * // Verificar métricas a cada minuto
 * setInterval(async () => {
 *   const health = await monitoring.health();
 *   const metrics = {
 *     dbHealth: health.database.ok,
 *     cacheHealth: health.cache.ok,
 *     memoryUsage: process.memoryUsage().heapUsed / process.memoryUsage().heapTotal,
 *     errorRate: health.metrics.errors / health.metrics.requests,
 *     responseTime: health.metrics.avgResponseTime,
 *   };
 *   
 *   await alertService.evaluateMetrics(metrics);
 * }, 60000);
 */
