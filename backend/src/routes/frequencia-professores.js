const express = require('express');
const router = express.Router();
const TeacherAttendanceController = require('../controllers/TeacherAttendanceController');
const authorize = require('../middleware/authorize');

// Frequência dos DOCENTES é dado de RH — visível apenas à gestão e ao próprio
// corpo docente. Responsáveis/alunos não têm o que consultar aqui.
router.get('/', authorize('admin', 'diretor', 'secretaria', 'professor'), TeacherAttendanceController.list);
router.get('/pendencias', authorize('admin', 'diretor', 'secretaria', 'professor'), TeacherAttendanceController.listPendencias);
router.post('/', authorize('admin', 'diretor', 'secretaria'), TeacherAttendanceController.create);

module.exports = router;
