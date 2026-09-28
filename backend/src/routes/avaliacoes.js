const express = require('express');
const router = express.Router();
const AvaliacaoSistemaController = require('../controllers/AvaliacaoSistemaController');
const authJWT = require('../middleware/authJWT');
const bloquearPalavroes = require('../middleware/bloquearPalavroes');

router.post(
    '/',
    authJWT,
    bloquearPalavroes('texto', { recurso: 'avaliacao-sistema' }),
    AvaliacaoSistemaController.create
);
router.get('/public', AvaliacaoSistemaController.getPublic);

// Moderação prévia das avaliações que vão para a página inicial (Issue #489).
// A página é da rede inteira, então quem modera é a administração.
const authorize = require('../middleware/authorize');
router.get(
    '/moderacao',
    authJWT,
    authorize('admin'),
    AvaliacaoSistemaController.listarParaModeracao
);
router.patch(
    '/moderacao/:colecao/:id',
    authJWT,
    authorize('admin'),
    AvaliacaoSistemaController.moderar
);

module.exports = router;
