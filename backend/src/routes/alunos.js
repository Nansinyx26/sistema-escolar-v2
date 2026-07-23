const express = require('express');
const router = express.Router();
const StudentController = require('../controllers/StudentController');
const authorize = require('../middleware/authorize');

router.get('/codigos-secretos', authorize('admin', 'diretor', 'secretaria'), StudentController.listSecretCodes);
router.post('/:id/regenerar-codigo', authorize('admin', 'diretor', 'secretaria'), StudentController.regenerateSecretCode);
// SEGURANÇA (LGPD): a ficha do aluno traz CPF, endereço, dados de saúde e o
// código secreto. Leitura é da equipe escolar — responsáveis usam as rotas
// dedicadas em /api/responsavel, que verificam o vínculo.
router.get('/', authorize('admin', 'diretor', 'secretaria', 'professor'), StudentController.list);
router.get('/:id', authorize('admin', 'diretor', 'secretaria', 'professor'), StudentController.get);
// Escrita restrita à equipe escolar — responsáveis usam /api/responsavel/aluno/:id/dados
router.post('/', authorize('admin', 'diretor', 'secretaria', 'professor'), StudentController.create);
router.put('/:id', authorize('admin', 'diretor', 'secretaria', 'professor'), StudentController.update);
router.delete('/:id', authorize('admin', 'diretor', 'secretaria'), StudentController.delete);

module.exports = router;
