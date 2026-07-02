const express = require('express');
const router = express.Router();
const AttendanceController = require('../controllers/AttendanceController');
const verifyTimetable = require('../middleware/verifyTimetable');

router.get('/', AttendanceController.list);
router.post('/', verifyTimetable, AttendanceController.create);
router.post('/sync', verifyTimetable, AttendanceController.sync);

module.exports = router;
