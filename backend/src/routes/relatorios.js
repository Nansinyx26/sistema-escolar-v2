const express = require('express');
const router = express.Router();
const RelatorioController = require('../controllers/RelatorioController');
const authorize = require('../middleware/authorize');

// Rota para gerar boletim (Apenas Diretor, Professor ou o próprio Responsável do Aluno)
router.get('/boletim/:alunoId', authorize(['diretor', 'professor', 'responsavel', 'admin']), RelatorioController.gerarBoletim);

module.exports = router;
