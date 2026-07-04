const express = require('express');
const router = express.Router();
const AttendanceController = require('../controllers/AttendanceController');
const verifyTimetable = require('../middleware/verifyTimetable');
const authorize = require('../middleware/authorize');

router.get('/', AttendanceController.list);
router.post('/', authorize('admin', 'diretor', 'secretaria', 'professor'), verifyTimetable, AttendanceController.create);
router.post('/sync', authorize('admin', 'diretor', 'secretaria', 'professor'), verifyTimetable, AttendanceController.sync);

module.exports = router;
