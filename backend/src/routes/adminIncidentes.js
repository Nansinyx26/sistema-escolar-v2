/**
 * adminIncidentes.js — registro de incidentes de segurança (Issue #513).
 *
 * Montado em /api/admin/incidentes com authJWT + authorize('admin') em api.js.
 * Não existe rota de exclusão: a Resolução CD/ANPD nº 15/2024 manda guardar o
 * registro por no mínimo cinco anos.
 */
const express = require('express');
const router = express.Router();
const AdminIncidentesController = require('../controllers/AdminIncidentesController');

router.get('/', AdminIncidentesController.listar);
router.post('/', AdminIncidentesController.criar);
router.get('/:id', AdminIncidentesController.obter);
router.patch('/:id', AdminIncidentesController.atualizar);
router.post('/:id/encerrar', AdminIncidentesController.encerrar);

module.exports = router;
