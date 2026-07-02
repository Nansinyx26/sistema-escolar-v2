const express = require('express');
const router = express.Router();
const ComunicadoController = require('../controllers/ComunicadoController');
const authJWT = require('../middleware/authJWT');
const authorize = require('../middleware/authorize');

const ComentarioController = require('../controllers/ComentarioController');
const ReactionController = require('../controllers/ReactionController');

router.post('/', authJWT, authorize('diretor', 'admin', 'secretaria'), ComunicadoController.create);
router.get('/', authJWT, ComunicadoController.getAll);
router.get('/:id', authJWT, ComunicadoController.getById);
router.delete('/:id', authJWT, authorize('diretor', 'admin', 'secretaria'), ComunicadoController.delete);
router.post('/:id/read', authJWT, ComunicadoController.markAsRead);

// Rotas Legadas (suporte ao frontend antigo)
router.post('/:id/comentarios', authJWT, (req, res) => {
    req.body.comunicadoId = req.params.id;
    return ComentarioController.add(req, res);
});
router.post('/:id/reagir', authJWT, (req, res) => {
    req.body.messageId = req.params.id;
    return ReactionController.create(req, res);
});

module.exports = router;
