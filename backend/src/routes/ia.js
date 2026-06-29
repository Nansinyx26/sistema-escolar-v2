const express = require('express');
const router = express.Router();
const IAController = require('../controllers/IAController');
const RelatorioController = require('../controllers/RelatorioController');
const authorize = require('../middleware/authorize');

// Rota de análise preditiva do aluno
router.get('/analise/:alunoId', authorize(['diretor', 'professor', 'admin']), IAController.analisarDesempenho);

// Rota de análise global da turma
router.get('/turma/:turmaId', authorize(['diretor', 'admin']), IAController.analisarTurma);

// Rota de Mapa de Calor (Matriz Disciplina x Turma)
router.get('/mapa-calor', authorize(['diretor', 'admin']), IAController.gerarMapaCalor);

// Rota de Relatório BI (PDF global)
router.get('/relatorio-bi', authorize(['diretor', 'admin']), RelatorioController.gerarRelatorioBI);

// Rota de Insights Globais (Sumário Narrativo)
router.get('/insights-global', authorize(['diretor', 'admin']), IAController.getGlobalInsights);

// Rota de Chatbot (Todos os perfis — incluindo coordenador e secretaria)
router.post('/chatbot', authorize(['diretor', 'professor', 'responsavel', 'admin', 'coordenador', 'secretaria']), IAController.chatbot);

// Rota de Plano de Aula (Diretor, Professor, Admin)
router.post('/plano-aula', authorize(['diretor', 'professor', 'admin']), IAController.gerarPlanoAula);

// Rota de Plano de Estudos Personalizado (Todos os perfis autorizados)
router.post('/plano-estudo', authorize(['diretor', 'professor', 'responsavel', 'admin']), IAController.gerarPlanoEstudo);

module.exports = router;
