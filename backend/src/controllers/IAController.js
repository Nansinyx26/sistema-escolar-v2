/**
 * IAController — P2.5 Implementation
 * 
 * Separa lógica de chatbot e analytics de IAController
 * E fornece retrocompatibilidade completa com a estrutura legado.
 * 
 * @module IAController
 * @version 2.0
 */

const ChatbotService = require('../services/ChatbotService');
const AnalyticsService = require('../services/AnalyticsService');
const ChatMensagem = require('../models/ChatMensagem');
const logger = require('../utils/LoggerService');

// Controladores legados para retrocompatibilidade
const PedagogicoController = require('./PedagogicoController');
const MapaCalorController = require('./MapaCalorController');

/**
 * Chatbot Controller
 */
class ChatbotController {
  /**
   * POST /api/ia/chatbot
   * Processa mensagem do usuário
   */
  static async sendMessage(req, res) {
    try {
      let { message, alunoId } = req.body;
      const perfil = (req.user?.perfil || '').toLowerCase();
      const userId = req.user?.id || req.user?._id;
      const nomeUsuario = req.user?.nome || 'Usuário';

      logger.debug('Chatbot message received', { userId, message });

      if (!message || !message.trim()) {
        return res.status(400).json({ success: false, error: 'Mensagem vazia.' });
      }

      if (!perfil) {
        return res.status(403).json({ success: false, error: 'Perfil de usuário não autorizado.' });
      }

      if (message.length > 1000) {
        logger.warn(`[Chatbot] Mensagem truncada de ${message.length} para 1000 chars`);
        message = message.substring(0, 1000);
      }

      const { response, alunoId: resolvedAlunoId, options } = await ChatbotService.process({
        message,
        alunoId,
        perfil,
        userId,
        nomeUsuario,
        userEmail: req.user?.email,
        escolaId: req.escolaId, // Escopo multi-escola (definido por filtrarPorEscola)
      });

      logger.debug(`[ChatbotController] response="${response?.substring(0, 60)}" options=${JSON.stringify(options)}`);

      const perfilParaSalvar = ['admin', 'diretor', 'professor', 'responsavel', 'secretaria', 'coordenador'].includes(perfil) ?
        perfil :
        'admin';

      await ChatMensagem.create({
        usuarioId: String(userId),
        usuarioPerfil: perfilParaSalvar,
        usuarioNome: nomeUsuario,
        alunoId: resolvedAlunoId || null,
        pergunta: message,
        resposta: response,
      }).catch(error => logger.warn(`[Chatbot] Erro ao salvar histórico: ${error.message}`));

      return res.json({
        success: true,
        data: {
          response,
          alunoId: resolvedAlunoId,
          options: options || null
        }
      });
    } catch (error) {
      logger.error('Chatbot error:', error, { userId: req.user?.id });
      res.status(500).json({ success: false, error: 'Não foi possível processar sua pergunta. Tente novamente.' });
    }
  }

  /**
   * GET /api/chatbot/health
   * Health check do serviço do chatbot
   */
  static async health(req, res) {
    try {
      // ChatbotService não tem método explícito 'health', mas podemos checar se o processamento responde ou se está operacional.
      res.status(200).json({ ok: true, status: 'operational' });
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
      const relatorio = await AnalyticsService.relatorioTurma(turmaId, parseInt(bimestre, 10) || 1);

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
        bimestre ? parseInt(bimestre, 10) : null
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
        mes ? parseInt(mes, 10) : null
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
   * Health check do serviço de analytics
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

/**
 * GET /api/ia/gemini-status
 * Diagnóstico: informa se a chave do Gemini está configurada e se responde.
 * NUNCA expõe a chave — apenas qual variável está presente e o teste ao vivo.
 */
async function geminiStatus(req, res) {
  const varNames = ['GEMINI_KEY', 'GEMINI_API_KEY', 'GOOGLE_TTS_API_KEY', 'GOOGLE_API_KEY'];
  const varPresente = varNames.find((n) => process.env[n]);
  if (!varPresente) {
    return res.json({
      success: true,
      keyConfigured: false,
      liveOk: false,
      message: 'Nenhuma variável de chave do Gemini definida no servidor. Configure GEMINI_KEY no Render.',
    });
  }

  // Teste ao vivo (chamada mínima) — não interrompe em caso de falha.
  try {
    const voiceService = require('../services/voiceService');
    const resposta = await voiceService.generateInsightText('Responda apenas: OK', { maxOutputTokens: 5, temperature: 0 });
    return res.json({
      success: true,
      keyConfigured: true,
      variavel: varPresente,
      liveOk: Boolean(resposta && resposta.length),
      message: 'Gemini configurado e respondendo.',
    });
  } catch (err) {
    return res.json({
      success: true,
      keyConfigured: true,
      variavel: varPresente,
      liveOk: false,
      quotaExceeded: Boolean(err.quotaExceeded),
      message: `Chave presente, mas o teste falhou: ${err.message}`,
    });
  }
}

module.exports = {
  ChatbotController,
  AnalyticsController,
  geminiStatus,

  // Retrocompatibilidade total caso algum import legada utilize a forma chave/valor antiga:
  chatbot: ChatbotController.sendMessage,
  analisarDesempenho: PedagogicoController.analisarDesempenho,
  getGlobalInsights: PedagogicoController.getGlobalInsights,
  gerarPlanoAula: PedagogicoController.gerarPlanoAula,
  gerarPlanoEstudo: PedagogicoController.gerarPlanoEstudo,
  analisarTurma: PedagogicoController.analisarTurma,
  gerarMapaCalor: MapaCalorController.gerarMapaCalor,
};