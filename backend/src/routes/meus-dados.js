const express = require('express');
const router = express.Router();
const MeusDadosController = require('../controllers/MeusDadosController');

router.get('/', MeusDadosController.exportarMeusDados);
router.post('/solicitar-exclusao', MeusDadosController.solicitarExclusao);
router.get('/status-consentimento', MeusDadosController.statusConsentimento);
router.get('/pedidos', MeusDadosController.listarMeusPedidos);

module.exports = router;
