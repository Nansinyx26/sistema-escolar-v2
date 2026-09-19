const express = require('express');
const router = express.Router();
const ConviteEquipeController = require('../controllers/ConviteEquipeController');

// Montado em /api/admin/convites-equipe com authJWT + authorize('admin') no
// api.js: uma rota nova aqui nasce restrita ao admin sem depender de lembrar.
router.get('/', ConviteEquipeController.listar);
router.post('/', ConviteEquipeController.criar);
router.delete('/:id', ConviteEquipeController.revogar);

module.exports = router;
