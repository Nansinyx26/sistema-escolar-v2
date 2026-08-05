const express = require('express');
const router = express.Router();
const FaltaFuncionarioController = require('../controllers/FaltaFuncionarioController');
const authorize = require('../middleware/authorize');

// Planilha de faltas do QUADRO DE FUNCIONÁRIOS — dado de RH.
// Responsáveis e alunos não têm nada a ver com esta tela.
// O escopo fino (professor só vê a própria planilha) é aplicado dentro do
// controller, que precisa resolver o funcionário antes de decidir.
const EQUIPE = authorize('admin', 'diretor', 'secretaria', 'professor');
const GESTAO = authorize('admin', 'diretor', 'secretaria');

router.get('/contexto', EQUIPE, FaltaFuncionarioController.contexto);
router.get('/funcionarios', GESTAO, FaltaFuncionarioController.funcionarios);
router.get('/resumo', GESTAO, FaltaFuncionarioController.resumo);
router.get('/planilha', EQUIPE, FaltaFuncionarioController.getPlanilha);
router.put('/planilha', EQUIPE, FaltaFuncionarioController.salvarPlanilha);

module.exports = router;
