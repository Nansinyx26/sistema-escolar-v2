const express = require('express');
const router = express.Router();
const TeacherController = require('../controllers/TeacherController');
const authorize = require('../middleware/authorize');

// SEGURANÇA: o cadastro pedagógico expõe CPF, telefone e as turmas de cada
// docente — e as turmas decidem o escopo horizontal. Nenhuma dessas rotas
// pode ficar aberta a responsáveis/alunos, e a escrita é da gestão.
const equipe = authorize('admin', 'diretor', 'secretaria', 'professor');
const gestao = authorize('admin', 'diretor', 'secretaria');

router.get('/', equipe, TeacherController.list);
// Status online — precisa vir ANTES de '/:id' para não ser capturada como id.
router.get('/status-online', authorize('admin', 'diretor', 'secretaria'), TeacherController.statusOnline);
router.get('/:id', equipe, TeacherController.get);
router.post('/', gestao, TeacherController.create);
router.put('/:id', equipe, TeacherController.update);
router.delete('/:id', authorize('admin'), TeacherController.delete);

module.exports = router;
