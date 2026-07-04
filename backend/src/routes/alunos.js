const express = require('express');
const router = express.Router();
const StudentController = require('../controllers/StudentController');
const authorize = require('../middleware/authorize');

router.get('/codigos-secretos', authorize('admin', 'diretor', 'secretaria'), StudentController.listSecretCodes);
router.get('/', StudentController.list);
router.get('/:id', StudentController.get);
// Escrita restrita à equipe escolar — responsáveis usam /api/responsavel/aluno/:id/dados
router.post('/', authorize('admin', 'diretor', 'secretaria', 'professor'), StudentController.create);
router.put('/:id', authorize('admin', 'diretor', 'secretaria', 'professor'), StudentController.update);
router.delete('/:id', authorize('admin', 'diretor', 'secretaria'), StudentController.delete);

module.exports = router;
