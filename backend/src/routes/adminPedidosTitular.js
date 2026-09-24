/**
 * adminPedidosTitular.js
 * Rotas administrativas para atendimento e despacho de requisições LGPD do titular (Issue #413).
 * Montado em /api/admin/pedidos-titular com authJWT + authorize('admin') em api.js.
 */
const express = require('express');
const router = express.Router();
const AdminPedidosTitularController = require('../controllers/AdminPedidosTitularController');

router.get('/', AdminPedidosTitularController.listarPedidos);
router.get('/:id', AdminPedidosTitularController.obterPedido);
router.patch('/:id', AdminPedidosTitularController.atualizarStatus);

module.exports = router;
