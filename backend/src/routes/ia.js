const express = require('express');
const router = express.Router();
const IAController = require('../controllers/IAController');
const IaCopilotoController = require('../controllers/IaCopilotoController');
const RelatorioController = require('../controllers/RelatorioController');
const authorize = require('../middleware/authorize');
const { requireAcessoAoAluno } = require('../middleware/assertAcessoAoAluno');
const { iaChatUsuarioLimiter, iaChatIpLimiter } = require('../middleware/rateLimiters');

// SEGURANÇA: as três rotas abaixo recebiam :alunoId e o repassavam direto ao
// AnalyticsService — um responsável iterava IDs e montava o perfil de
// desempenho de qualquer criança; um professor fazia o mesmo fora das suas
// turmas. `requireAcessoAoAluno` valida escola + turma + vínculo.
const acessoAluno = requireAcessoAoAluno('alunoId');

// Rota de análise preditiva do aluno (Refatorado para AnalyticsController)
router.get('/analise/:alunoId', authorize(['diretor', 'professor', 'admin']), acessoAluno, IAController.AnalyticsController.desempenhoAluno);

// Rota de análise frequência do aluno (Novo endpoint no AnalyticsController)
router.get('/frequencia/:alunoId', authorize(['diretor', 'professor', 'admin']), acessoAluno, IAController.AnalyticsController.frequenciaAluno);

// Rota de dashboard completo do aluno (AnalyticsController)
router.get('/dashboard/:alunoId', authorize(['diretor', 'professor', 'admin', 'responsavel']), acessoAluno, IAController.AnalyticsController.dashboardAluno);

// Rota de análise global da turma (Refatorado para AnalyticsController)
router.get('/turma/:turmaId', authorize(['diretor', 'admin']), IAController.AnalyticsController.relatorioTurma);

// Rota de Mapa de Calor (Matriz Disciplina x Turma - Legado/Mantido)
router.get('/mapa-calor', authorize(['diretor', 'admin']), IAController.gerarMapaCalor);

// Rota de Relatório BI (PDF global - Legado/Mantido)
router.get('/relatorio-bi', authorize(['diretor', 'admin']), RelatorioController.gerarRelatorioBI);

// Rota de Insights Globais (Sumário Narrativo - Legado/Mantido)
router.get('/insights-global', authorize(['diretor', 'admin']), IAController.getGlobalInsights);

// ============================================
// COPILOTO — conversa em streaming (SSE)
// ============================================
// Este router já é montado em api.js com `authJWT + horizontalFilter +
// filtrarPorEscola`, então quando a requisição chega aqui `req.user` está
// verificado e `req.escolaId` resolvido. O ContextBuilder lê SÓ desses dois —
// nunca do corpo da requisição.
//
// O `authorize` abaixo lista todos os perfis válidos do sistema
// (Usuario.perfil): não restringe nada hoje, mas deixa a lista de acesso
// auditável em um lugar só e é onde a Fase 2 encosta o filtro por cargo.
//
// Os limiters vêm ANTES do authorize de propósito: uma rajada de requisições
// não autorizadas também gasta CPU, e o teto por IP precisa valer para ela.
const PERFIS_COPILOTO = ['diretor', 'professor', 'secretaria', 'responsavel', 'admin'];

router.post('/chat',
    iaChatIpLimiter,
    iaChatUsuarioLimiter,
    authorize(PERFIS_COPILOTO),
    IaCopilotoController.chat);

// Execução de ação confirmada. Mantém o limiter por IP: é o único endpoint do
// copiloto que ESCREVE, e um laço de tentativas com tokens forjados não deve
// sair de graça. O teto por usuário fica de fora porque uma sessão legítima
// pode confirmar várias ações seguidas sem gastar cota do modelo.
router.post('/confirmar',
    iaChatIpLimiter,
    authorize(PERFIS_COPILOTO),
    IaCopilotoController.confirmar);

router.post('/cancelar',
    authorize(PERFIS_COPILOTO),
    IaCopilotoController.cancelar);

// Histórico de conversas. Sem limiter de IA: são leituras baratas no Mongo, já
// cobertas pelo globalLimiter — o teto de 20/min existe para a cota do modelo,
// e aplicá-lo aqui faria a sidebar travar durante um uso normal.
router.get('/conversas',
    authorize(PERFIS_COPILOTO),
    IaCopilotoController.listarConversas);

router.get('/conversas/:id',
    authorize(PERFIS_COPILOTO),
    IaCopilotoController.obterConversa);

router.delete('/conversas/:id',
    authorize(PERFIS_COPILOTO),
    IaCopilotoController.removerConversa);

// Paleta de comandos rápidos — a lista é filtrada por cargo no servidor.
router.get('/comandos',
    authorize(PERFIS_COPILOTO),
    IaCopilotoController.listarComandos);

// Exportação da conversa (PDF/TXT/DOCX). O escopo dono+escola é o mesmo da
// leitura, então não há como exportar o histórico de outra pessoa.
router.post('/exportar/:id',
    authorize(PERFIS_COPILOTO),
    IaCopilotoController.exportarConversa);

// Rota de Chatbot (ChatbotController / Refatorado)
router.post('/chatbot', authorize(['diretor', 'professor', 'responsavel', 'admin', 'coordenador', 'secretaria']), IAController.ChatbotController.sendMessage);

// Rota de Plano de Aula (Diretor, Professor, Admin - Legado/Mantido)
router.post('/plano-aula', authorize(['diretor', 'professor', 'admin']), IAController.gerarPlanoAula);

// Rota de Plano de Estudos Personalizado (Todos os perfis autorizados - Legado/Mantido)
// SEGURANÇA: recebe alunoId no body e monta o PEI com notas/turma/previsão reais
// do aluno. Sem este guard, um responsável/professor iterava IDs e extraía o
// perfil de qualquer criança de qualquer escola. `acessoAluno` valida escola +
// turma + vínculo (mesmo padrão de /analise, /frequencia e /dashboard).
router.post('/plano-estudo', authorize(['diretor', 'professor', 'responsavel', 'admin']), acessoAluno, IAController.gerarPlanoEstudo);

// Rota de Health Check de IA
router.get('/health', IAController.AnalyticsController.health);

// Diagnóstico da chave do Gemini (diretor/admin) — valida config sem expor a chave
router.get('/gemini-status', authorize(['diretor', 'admin']), IAController.geminiStatus);

module.exports = router;
