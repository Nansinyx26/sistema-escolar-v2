const express = require('express');
const router = express.Router();
const TeacherAssignmentController = require('../controllers/TeacherAssignmentController');
const authorize = require('../middleware/authorize');

router.get('/', TeacherAssignmentController.index);
router.post('/sync', authorize('admin', 'diretor'), TeacherAssignmentController.sync);
router.delete('/:id', authorize('admin'), TeacherAssignmentController.delete);

module.exports = router;
