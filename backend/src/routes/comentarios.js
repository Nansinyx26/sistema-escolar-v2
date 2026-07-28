const express = require('express');
const router = express.Router();
const ComentarioController = require('../controllers/ComentarioController');
const authJWT = require('../middleware/authJWT');
const bloquearPalavroes = require('../middleware/bloquearPalavroes');

// O filtro de linguagem roda ANTES do controller — comentário com palavrão não
// chega a existir no banco, então não há o que moderar depois nem evento de
// Socket.IO propagando o texto para os outros usuários da thread.
const filtrarTexto = bloquearPalavroes('texto', { recurso: 'comentario' });

router.post('/', authJWT, filtrarTexto, ComentarioController.add);
router.get('/comunicado/:comunicadoId', authJWT, ComentarioController.getByComunicado);
router.get('/notificacao/:notificacaoId', authJWT, ComentarioController.getByNotificacao);
router.put('/:id', authJWT, filtrarTexto, ComentarioController.update);
router.delete('/:id', authJWT, ComentarioController.delete);

module.exports = router;
