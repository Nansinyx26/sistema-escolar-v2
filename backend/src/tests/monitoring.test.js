/**
 * monitoring.test.js
 * Testes de integração para monitoramento de produção (Roadmap #6)
 */

const request = require('supertest');
const app = require('../app');
const monitoring = require('../services/MonitoringService');
const alertService = require('../services/AlertService');
const { initializeCache } = require('../services/CacheService');
const { conectarBanco, limparBanco, desconectarBanco } = require('./helpers');
const mongoose = require('mongoose');

beforeAll(async () => {
  await conectarBanco();
  // Garante que o Mongoose está conectado para o teste de saúde
  if (mongoose.connection.readyState !== 1) {
    const uri = process.env.MONGODB_URI || process.env.MONGODB_URI_TEST || 'mongodb://127.0.0.1:27017/escola_db_test';
    await mongoose.connect(uri);
  }
  // Inicializa o cache para o ambiente de testes
  await initializeCache();
});

afterAll(async () => {
  // Limpa o loop de monitoramento para evitar processos pendentes no Jest
  monitoring.stopHealthCheckLoop();
  await desconectarBanco();
});

describe('Monitoring & Alerts Integration Tests', () => {
  
  it('deve retornar dados de saúde estruturados em /api/monitoring/health', async () => {
    const res = await request(app).get('/api/monitoring/health');
    
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('healthy');
    expect(res.body.timestamp).toBeDefined();
    expect(res.body.metrics).toBeDefined();
  });

  it('deve expor métricas Prometheus no formato text/plain em /api/metrics', async () => {
    const res = await request(app).get('/api/metrics');
    
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/plain');
    expect(res.text).toContain('app_requests_total');
    expect(res.text).toContain('app_response_time_avg');
  });

  it('deve registrar requisições e atualizar contadores nas métricas', async () => {
    const initialMetrics = await monitoring.health();
    const initialRequests = initialMetrics.metrics.requests;

    // Faz uma chamada
    await request(app).get('/api/monitoring/health');

    // Aguarda o finish listener assíncrono do middleware atualizar a métrica
    await new Promise(resolve => setTimeout(resolve, 50));

    const updatedMetrics = await monitoring.health();
    expect(updatedMetrics.metrics.requests).toBeGreaterThanOrEqual(initialRequests + 1);
  });

  it('deve avaliar métricas de alerta corretamente no AlertService', async () => {
    const mockMetrics = {
      dbHealth: false, // Força banco offline
      cacheHealth: true,
      memoryUsage: 0.95, // Força uso crítico de memória (> 90%)
      errorRate: 0.25,
      responseTime: 8000, // Força lentidão extrema (> 1000ms)
    };

    const alerts = await alertService.evaluateMetrics(mockMetrics);
    
    expect(alerts.length).toBeGreaterThan(0);
    
    const dbAlert = alerts.find(a => a.name === 'database_down');
    const memoryAlert = alerts.find(a => a.name === 'memory_usage_high');
    const latencyAlert = alerts.find(a => a.name === 'database_slow');

    expect(dbAlert).toBeDefined();
    expect(memoryAlert).toBeDefined();
    expect(latencyAlert).toBeDefined();
  });
});
