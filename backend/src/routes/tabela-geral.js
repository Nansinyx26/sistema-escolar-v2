const express = require('express');
const router = express.Router();
const TabelaGeralController = require('../controllers/TabelaGeralController');
const authorize = require('../middleware/authorize');

router.get('/', TabelaGeralController.list);
router.get('/sala/:turmaId', TabelaGeralController.getSala);
router.get('/prof/:professorKey', TabelaGeralController.getProfessor);
router.put('/celula', authorize('admin', 'diretor', 'secretaria'), TabelaGeralController.updateCell);
router.post('/seed', authorize('admin'), TabelaGeralController.seed);
router.delete('/reset', authorize('admin'), TabelaGeralController.reset);

module.exports = router;
