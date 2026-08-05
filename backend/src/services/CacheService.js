/**
 * Cache Service — P2 Implementation
 * 
 * Abstração para cache (suporta Redis ou Node-cache)
 * Reduz carga em MongoDB, melhora latência de API
 * 
 * @module CacheService
 * @version 2.0
 */

const NodeCache = require('node-cache');

// Detectar Redis em produção
let redis = null;
if (process.env.REDIS_URL) {
  try {
    redis = require('redis');
  } catch (e) {
    console.warn('Redis não instalado, usando Node-cache');
  }
}

/**
 * Inicializa cliente Redis ou Node-cache
 */
let cacheClient = null;

const initializeCache = async () => {
  if (process.env.REDIS_URL && redis) {
    try {
      cacheClient = redis.createClient({ url: process.env.REDIS_URL });
      cacheClient.on('error', (err) => console.error('Redis error:', err));
      await cacheClient.connect();
      console.log('✅ Cache: Redis conectado');
      return true;
    } catch (error) {
      console.warn('⚠️ Falha ao conectar Redis, fallback para Node-cache');
    }
  }

  // Fallback: Node-cache (em-memory)
  cacheClient = new NodeCache({ 
    stdTTL: 3600,        // 1 hora padrão
    checkperiod: 600     // Check a cada 10 min
  });
  console.log('✅ Cache: Node-cache inicializado');
  return true;
};

/**
 * Cache Service — Interface padronizada
 */
class CacheService {
  /**
   * Get valor do cache
   * @param {string} key - Chave
   * @returns {Promise<any>} Valor ou null
   */
  static async get(key) {
    try {
      if (redis && cacheClient?.isOpen !== false) {
        const value = await cacheClient.get(key);
        return value ? JSON.parse(value) : null;
      } else if (cacheClient instanceof NodeCache) {
        return cacheClient.get(key);
      }
    } catch (error) {
      console.error(`Cache GET error for key ${key}:`, error);
    }
    return null;
  }

  /**
   * Set valor no cache
   * @param {string} key - Chave
   * @param {any} value - Valor para armazenar
   * @param {number} ttl - TTL em segundos (default: 3600)
   */
  static async set(key, value, ttl = 3600) {
    try {
      if (redis && cacheClient?.isOpen !== false) {
        await cacheClient.setEx(key, ttl, JSON.stringify(value));
      } else if (cacheClient instanceof NodeCache) {
        cacheClient.set(key, value, ttl);
      }
      return true;
    } catch (error) {
      console.error(`Cache SET error for key ${key}:`, error);
      return false;
    }
  }

  /**
   * Delete valor do cache
   * @param {string} key - Chave
   */
  static async delete(key) {
    try {
      if (redis && cacheClient?.isOpen !== false) {
        await cacheClient.del(key);
      } else if (cacheClient instanceof NodeCache) {
        cacheClient.del(key);
      }
      return true;
    } catch (error) {
      console.error(`Cache DELETE error for key ${key}:`, error);
      return false;
    }
  }

  /**
   * Clear todo o cache
   */
  static async flush() {
    try {
      if (redis && cacheClient?.isOpen !== false) {
        await cacheClient.flushDb();
      } else if (cacheClient instanceof NodeCache) {
        cacheClient.flushAll();
      }
      return true;
    } catch (error) {
      console.error('Cache FLUSH error:', error);
      return false;
    }
  }

  /**
   * Get ou calcular (pattern comum)
   * @param {string} key - Chave
   * @param {Function} fetchFn - Função para buscar dados
   * @param {number} ttl - TTL em segundos
   */
  static async getOrSet(key, fetchFn, ttl = 3600) {
    // Tentar cache
    let cached = await this.get(key);
    if (cached) return cached;

    // Buscar dados
    const data = await fetchFn();
    if (data) {
      await this.set(key, data, ttl);
    }
    return data;
  }

  /**
   * Chaves de cache padronizadas
   */
  static keys = {
    // Usuários
    user: (id) => `user:${id}`,
    userEmail: (email) => `user:email:${email}`,
    userList: (page, limit) => `users:list:${page}:${limit}`,

    // Turmas
    turma: (id) => `turma:${id}`,
    turmaList: (page) => `turmas:list:${page}`,
    turmaAlunos: (turmaId, page) => `turma:${turmaId}:alunos:${page}`,

    // Notas
    notaAluno: (alunoId, bimestre) => `nota:${alunoId}:${bimestre}`,
    notaTurma: (turmaId, bimestre) => `notas:turma:${turmaId}:${bimestre}`,

    // Comunicados
    comunicadoList: (page, limit) => `comunicados:list:${page}:${limit}`,
    comunicado: (id) => `comunicado:${id}`,

    // Relatórios (cache mais longo)
    relatorioFrequencia: (turmaId, mes) => `relatorio:freq:${turmaId}:${mes}`,
    relatorioBimestral: (turmaId, bimestre) => `relatorio:bi:${turmaId}:${bimestre}`,

    // Agregações (cache longo)
    dashboard: (userId) => `dashboard:${userId}`,
    statsGeral: () => `stats:geral`,
  };

  /**
   * Invalidar cache por padrão
   * @param {string} pattern - Pattern ex: 'turma:123:*'
   */
  static async invalidateByPattern(pattern) {
    try {
      if (redis && cacheClient?.isOpen !== false) {
        const keys = await cacheClient.keys(pattern);
        if (keys.length > 0) {
          await cacheClient.del(keys);
        }
      } else if (cacheClient instanceof NodeCache) {
        const allKeys = cacheClient.keys();
        const regex = new RegExp(`^${pattern.replace('*', '.*')}$`);
        allKeys.forEach(key => {
          if (regex.test(key)) {
            cacheClient.del(key);
          }
        });
      }
      return true;
    } catch (error) {
      console.error(`Cache INVALIDATE pattern ${pattern} error:`, error);
      return false;
    }
  }

  /**
   * Health check
   */
  static async health() {
    try {
      const testKey = 'health-check-' + Date.now();
      await this.set(testKey, { ok: true }, 1);
      const result = await this.get(testKey);
      await this.delete(testKey);
      return result?.ok === true;
    } catch (error) {
      return false;
    }
  }
}

module.exports = {
  CacheService,
  initializeCache,
};
