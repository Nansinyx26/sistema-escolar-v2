const express = require('express');
const router = express.Router();
const RelatorioController = require('../controllers/RelatorioController');
const authorize = require('../middleware/authorize');

// Rota para gerar boletim (Apenas Diretor, Professor, Responsável, Secretaria ou Admin)
router.get('/boletim/:alunoId', authorize(['diretor', 'professor', 'responsavel', 'admin', 'secretaria']), RelatorioController.gerarBoletim);

module.exports = router;
