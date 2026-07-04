const express = require('express');
const router = express.Router();
const TeacherAttendanceController = require('../controllers/TeacherAttendanceController');
const authorize = require('../middleware/authorize');

router.get('/', TeacherAttendanceController.list);
router.get('/pendencias', TeacherAttendanceController.listPendencias);
router.post('/', authorize('admin', 'diretor', 'secretaria'), TeacherAttendanceController.create);

module.exports = router;
