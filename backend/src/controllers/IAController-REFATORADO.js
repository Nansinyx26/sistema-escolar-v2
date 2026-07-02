/**
 * IAController Refactored — P2.5 Implementation
 * 
 * Separa lógica de chatbot e analytics de IAController
 * Melhor separação de responsabilidades
 * 
 * @module IAController
 * @version 2.0
 */

const ChatbotService = require('../services/ChatbotService');
const AnalyticsService = require('../services/AnalyticsService');
const logger = require('../utils/LoggerService');

/**
 * Chatbot Controller
 */
class ChatbotController {
  /**
   * POST /api/chatbot/message
   * Processa mensagem do usuário
   */
  static async sendMessage(req, res) {
    try {
      const { mensagem, contexto = {} } = req.validatedBody;
      const usuarioId = req.user._id;

      logger.debug('Chatbot message received', { usuarioId, mensagem });

      const result = await ChatbotService.processMessage(mensagem, contexto);

      if (!result.success) {
        return res.status(400).json(result);
      }

      res.json({
        success: true,
        resposta: result.resposta,
        confidence: result.confidence,
        timestamp: new Date(),
      });
    } catch (error) {
      logger.error('Chatbot error:', error, { userId: req.user._id });
      res.status(500).json({ success: false, error: 'Erro ao processar mensagem' });
    }
  }

  /**
   * POST /api/chatbot/conversa
   * Processa conversa com histórico
   */
  static async conversa(req, res) {
    try {
      const { mensagens } = req.validatedBody;
      const usuarioId = req.user._id;

      const result = await ChatbotService.processConversa(mensagens, usuarioId);

      if (!result.success) {
        return res.status(400).json(result);
      }

      res.json(result);
    } catch (error) {
      logger.error('Chatbot conversa error:', error);
      res.status(500).json({ success: false, error: 'Erro na conversa' });
    }
  }

  /**
   * GET /api/chatbot/intent/:mensagem
   * Classificar intenção da mensagem
   */
  static async extractIntent(req, res) {
    try {
      const { mensagem } = req.params;

      const result = await ChatbotService.extractIntent(mensagem);

      if (!result.success) {
        return res.status(400).json(result);
      }

      res.json(result);
    } catch (error) {
      logger.error('Intent extraction error:', error);
      res.status(500).json({ success: false, error: 'Erro ao extrair intenção' });
    }
  }

  /**
   * GET /api/chatbot/health
   * Health check do serviço
   */
  static async health(req, res) {
    try {
      const health = await ChatbotService.health();
      res.status(health.ok ? 200 : 503).json(health);
    } catch (error) {
      res.status(503).json({ ok: false, error: error.message });
    }
  }
}

/**
 * Analytics Controller
 */
class AnalyticsController {
  /**
   * GET /api/analytics/aluno/:alunoId
   * Dashboard de aluno
   */
  static async dashboardAluno(req, res) {
    try {
      const { alunoId } = req.params;

      const dashboard = await AnalyticsService.dashboardAluno(alunoId);

      if (!dashboard.success) {
        return res.status(400).json(dashboard);
      }

      res.json(dashboard);
    } catch (error) {
      logger.error('Analytics dashboard error:', error);
      res.status(500).json({ success: false, error: 'Erro ao gerar dashboard' });
    }
  }

  /**
   * GET /api/analytics/turma/:turmaId/bimestre/:bimestre
   * Relatório de turma
   */
  static async relatorioTurma(req, res) {
    try {
      const { turmaId, bimestre } = req.params;

      const relatorio = await AnalyticsService.relatorioTurma(turmaId, bimestre);

      if (!relatorio.success) {
        return res.status(400).json(relatorio);
      }

      res.json(relatorio);
    } catch (error) {
      logger.error('Analytics report error:', error);
      res.status(500).json({ success: false, error: 'Erro ao gerar relatório' });
    }
  }

  /**
   * GET /api/analytics/aluno/:alunoId/desempenho
   * Análise de desempenho
   */
  static async desempenhoAluno(req, res) {
    try {
      const { alunoId } = req.params;
      const { bimestre } = req.query;

      const desempenho = await AnalyticsService.analisarDesempenhoAluno(
        alunoId,
        bimestre
      );

      if (!desempenho.success) {
        return res.status(400).json(desempenho);
      }

      res.json(desempenho);
    } catch (error) {
      logger.error('Performance analysis error:', error);
      res.status(500).json({ success: false, error: 'Erro na análise de desempenho' });
    }
  }

  /**
   * GET /api/analytics/aluno/:alunoId/frequencia
   * Análise de frequência
   */
  static async frequenciaAluno(req, res) {
    try {
      const { alunoId } = req.params;
      const { mes } = req.query;

      const frequencia = await AnalyticsService.analisarFrequenciaAluno(
        alunoId,
        mes
      );

      if (!frequencia.success) {
        return res.status(400).json(frequencia);
      }

      res.json(frequencia);
    } catch (error) {
      logger.error('Attendance analysis error:', error);
      res.status(500).json({ success: false, error: 'Erro na análise de frequência' });
    }
  }

  /**
   * GET /api/analytics/health
   * Health check do serviço
   */
  static async health(req, res) {
    try {
      const health = await AnalyticsService.health();
      res.status(health.ok ? 200 : 503).json(health);
    } catch (error) {
      res.status(503).json({ ok: false, error: error.message });
    }
  }
}

module.exports = {
  ChatbotController,
  AnalyticsController,
};
