const express = require('express');
const router = express.Router();
const NotificacaoController = require('../controllers/NotificacaoController');
const authorize = require('../middleware/authorize');

// SEGURANÇA: criar e apagar avisos internos é ato de gestão. Sem authorize,
// um responsável criava avisos falsos direcionados a professores/diretores
// (phishing dentro do sistema) e apagava comunicados oficiais de qualquer
// escola da rede.
const gestao = authorize('admin', 'diretor', 'secretaria');

router.get('/', NotificacaoController.getAll);
router.post('/', gestao, NotificacaoController.create);
router.put('/marcar-todas-lidas', NotificacaoController.marcarTodasComoLidas);
router.put('/:id/ler', NotificacaoController.marcarComoLida);
router.delete('/:id', gestao, NotificacaoController.delete);

module.exports = router;
