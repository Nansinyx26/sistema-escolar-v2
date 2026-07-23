const express = require('express');
const router = express.Router();
const AttendanceController = require('../controllers/AttendanceController');
const verifyTimetable = require('../middleware/verifyTimetable');
const authorize = require('../middleware/authorize');

// Frequência é dado da equipe escolar — responsáveis usam
// /api/responsavel/frequencia/:alunoId, que verifica o vínculo. Sem este
// authorize, um responsável recebia as faltas de TODA a escola com os
// documentos de aluno populados (.populate('aluno')).
router.get('/', authorize('admin', 'diretor', 'secretaria', 'professor'), AttendanceController.list);
router.post('/', authorize('admin', 'diretor', 'secretaria', 'professor'), verifyTimetable, AttendanceController.create);
router.post('/sync', authorize('admin', 'diretor', 'secretaria', 'professor'), verifyTimetable, AttendanceController.sync);

module.exports = router;
