const express = require('express');
const router = express.Router();
const ComentarioController = require('../controllers/ComentarioController');
const authJWT = require('../middleware/authJWT');

router.post('/', authJWT, ComentarioController.add);
router.get('/comunicado/:comunicadoId', authJWT, ComentarioController.getByComunicado);
router.put('/:id', authJWT, ComentarioController.update);
router.delete('/:id', authJWT, ComentarioController.delete);

module.exports = router;
