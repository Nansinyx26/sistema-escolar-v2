const express = require('express');
const router = express.Router();
const NotificacaoController = require('../controllers/NotificacaoController');

router.get('/', NotificacaoController.getAll);
router.post('/', NotificacaoController.create);
router.put('/marcar-todas-lidas', NotificacaoController.marcarTodasComoLidas);
router.put('/:id/ler', NotificacaoController.marcarComoLida);
router.delete('/:id', NotificacaoController.delete);

module.exports = router;
