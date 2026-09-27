const express = require('express');
const router = express.Router();
const ClassController = require('../controllers/ClassController');
const authorize = require('../middleware/authorize');

// Situação das autorizações da turma, para o professor (Issue #496). Vem
// antes das rotas com parâmetro para não ser lida como um id de turma.
router.get(
    '/autorizacoes/situacao',
    authorize('professor'),
    require('../controllers/AutorizacoesTurmaController').situacaoDaTurma
);
router.get('/', ClassController.list);
router.post('/', authorize('admin', 'diretor', 'secretaria'), ClassController.create);
router.delete('/:id', authorize('admin'), ClassController.delete);

module.exports = router;
