const express = require('express');
const router = express.Router();
const RelatorioController = require('../controllers/RelatorioController');
const RelatorioDiarioController = require('../controllers/RelatorioDiarioController');
const authorize = require('../middleware/authorize');

// Diário de classe da aba "Relatórios Diários" da página de turma.
// Antes de `/boletim/:alunoId` porque `/diarios` é rota fixa e não deve
// ser capturada por nenhum parâmetro.
const podeEscreverRelatorio = authorize(['diretor', 'professor', 'secretaria', 'admin']);
router.get('/diarios', podeEscreverRelatorio, RelatorioDiarioController.listar);
router.put('/diarios', podeEscreverRelatorio, RelatorioDiarioController.salvar);

// Rota para gerar boletim (Apenas Diretor, Professor, Responsável, Secretaria ou Admin)
router.get('/boletim/:alunoId', authorize(['diretor', 'professor', 'responsavel', 'admin', 'secretaria']), RelatorioController.gerarBoletim);

module.exports = router;
