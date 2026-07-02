const express = require('express');
const router = express.Router();
const AvaliacaoSistemaController = require('../controllers/AvaliacaoSistemaController');
const authJWT = require('../middleware/authJWT');

router.post('/', authJWT, AvaliacaoSistemaController.create);
router.get('/public', AvaliacaoSistemaController.getPublic);

module.exports = router;
