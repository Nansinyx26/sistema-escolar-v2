const express = require('express');
const router = express.Router();
const ComunicadoController = require('../controllers/ComunicadoController');
const authJWT = require('../middleware/authJWT');
const authorize = require('../middleware/authorize');

router.post('/', authJWT, authorize('diretor', 'admin'), ComunicadoController.create);
router.get('/', authJWT, ComunicadoController.getAll);
router.get('/:id', authJWT, ComunicadoController.getById);
router.delete('/:id', authJWT, authorize('diretor', 'admin'), ComunicadoController.delete);
router.post('/:id/read', authJWT, ComunicadoController.markAsRead);

module.exports = router;
