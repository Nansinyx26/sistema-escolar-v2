const express = require('express');
const router = express.Router();
const SecurityController = require('../controllers/SecurityController');
const authorize = require('../middleware/authorize');

// O código devolvido/rotacionado aqui é o da ESCOLA de quem chama (admin opera
// no global) — ver a nota de escopo em SecurityController.escolaDaSessao.
router.get('/status', authorize('admin', 'diretor'), (req, res) => SecurityController.getStatus(req, res));
router.post('/rotate', authorize('admin', 'diretor'), (req, res) => SecurityController.forceRotate(req, res));
// Alias legado usado por direcao/direcao.js — mesmo handler escopado.
router.post('/director-code', authorize('admin', 'diretor'), (req, res) => SecurityController.forceRotate(req, res));

module.exports = router;
