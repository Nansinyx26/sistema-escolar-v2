const express = require('express');
const router = express.Router();
const TeacherAttendanceController = require('../controllers/TeacherAttendanceController');

router.get('/', TeacherAttendanceController.list);
router.get('/pendencias', TeacherAttendanceController.listPendencias);
router.post('/', TeacherAttendanceController.create);

module.exports = router;
