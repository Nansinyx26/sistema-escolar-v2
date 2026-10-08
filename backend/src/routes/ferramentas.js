/**
 * routes/ferramentas.js — autorização de ferramentas por professor (Issue #720).
 *
 * `authJWT` e `filtrarPorEscola` são aplicados no MONTE (routes/api.js): toda
 * rota deste arquivo recebe `req.user` verificado e `req.escolaId` resolvido
 * a partir da sessão. As rotas de decisão são só da direção; o admin passa
 * pelo `authorize`, mas o controller exige a escola escolhida.
 */
const express = require('express');
const authorize = require('../middleware/authorize');
const FerramentasController = require('../controllers/FerramentasController');

const router = express.Router();

const EQUIPE = ['diretor', 'professor', 'secretaria'];

router.get('/catalogo', authorize(EQUIPE), FerramentasController.catalogo);
router.get('/minhas', authorize(EQUIPE), FerramentasController.minhas);

router.get('/autorizacoes', authorize('diretor'), FerramentasController.listarAutorizacoes);
router.put('/autorizacoes', authorize('diretor'), FerramentasController.salvar);

module.exports = router;
