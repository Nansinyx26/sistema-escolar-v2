const express = require('express');
const router = express.Router();
const AvaliacaoController = require('../controllers/AvaliacaoController');
const authorize = require('../middleware/authorize');

// Todas as rotas exigem autorização de equipe escolar (admin, diretor, secretaria, professor)
router.get('/', authorize('admin', 'diretor', 'secretaria', 'professor'), AvaliacaoController.list);
router.post(
    '/',
    authorize('admin', 'diretor', 'secretaria', 'professor'),
    AvaliacaoController.create
);
router.get(
    '/:id',
    authorize('admin', 'diretor', 'secretaria', 'professor'),
    AvaliacaoController.get
);
router.put(
    '/:id',
    authorize('admin', 'diretor', 'secretaria', 'professor'),
    AvaliacaoController.update
);
router.delete(
    '/:id',
    authorize('admin', 'diretor', 'secretaria', 'professor'),
    AvaliacaoController.delete
);

// Lançamento e histórico de notas
router.post(
    '/:id/notas',
    authorize('admin', 'diretor', 'secretaria', 'professor'),
    AvaliacaoController.lancarNotas
);
router.get(
    '/:id/historico',
    authorize('admin', 'diretor', 'secretaria', 'professor'),
    AvaliacaoController.historico
);

module.exports = router;
