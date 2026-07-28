const express = require('express');
const router = express.Router();
const AvaliacaoSistemaController = require('../controllers/AvaliacaoSistemaController');
const authJWT = require('../middleware/authJWT');
const bloquearPalavroes = require('../middleware/bloquearPalavroes');

router.post('/', authJWT, bloquearPalavroes('texto', { recurso: 'avaliacao-sistema' }), AvaliacaoSistemaController.create);
router.get('/public', AvaliacaoSistemaController.getPublic);

module.exports = router;
