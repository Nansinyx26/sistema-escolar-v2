const express = require('express');
const router = express.Router();
const IAController = require('../controllers/IAController');
const RelatorioController = require('../controllers/RelatorioController');
const authorize = require('../middleware/authorize');

// Rota de análise preditiva do aluno (Refatorado para AnalyticsController)
router.get('/analise/:alunoId', authorize(['diretor', 'professor', 'admin']), IAController.AnalyticsController.desempenhoAluno);

// Rota de análise frequência do aluno (Novo endpoint no AnalyticsController)
router.get('/frequencia/:alunoId', authorize(['diretor', 'professor', 'admin']), IAController.AnalyticsController.frequenciaAluno);

// Rota de dashboard completo do aluno (AnalyticsController)
router.get('/dashboard/:alunoId', authorize(['diretor', 'professor', 'admin', 'responsavel']), IAController.AnalyticsController.dashboardAluno);

// Rota de análise global da turma (Refatorado para AnalyticsController)
router.get('/turma/:turmaId', authorize(['diretor', 'admin']), IAController.AnalyticsController.relatorioTurma);

// Rota de Mapa de Calor (Matriz Disciplina x Turma - Legado/Mantido)
router.get('/mapa-calor', authorize(['diretor', 'admin']), IAController.gerarMapaCalor);

// Rota de Relatório BI (PDF global - Legado/Mantido)
router.get('/relatorio-bi', authorize(['diretor', 'admin']), RelatorioController.gerarRelatorioBI);

// Rota de Insights Globais (Sumário Narrativo - Legado/Mantido)
router.get('/insights-global', authorize(['diretor', 'admin']), IAController.getGlobalInsights);

// Rota de Chatbot (ChatbotController / Refatorado)
router.post('/chatbot', authorize(['diretor', 'professor', 'responsavel', 'admin', 'coordenador', 'secretaria']), IAController.ChatbotController.sendMessage);

// Rota de Plano de Aula (Diretor, Professor, Admin - Legado/Mantido)
router.post('/plano-aula', authorize(['diretor', 'professor', 'admin']), IAController.gerarPlanoAula);

// Rota de Plano de Estudos Personalizado (Todos os perfis autorizados - Legado/Mantido)
router.post('/plano-estudo', authorize(['diretor', 'professor', 'responsavel', 'admin']), IAController.gerarPlanoEstudo);

// Rota de Health Check de IA
router.get('/health', IAController.AnalyticsController.health);

module.exports = router;
