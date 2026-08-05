const express = require('express');
const router = express.Router();
const TeacherAssignmentController = require('../controllers/TeacherAssignmentController');
const authJWT = require('../middleware/authJWT');
const authorize = require('../middleware/authorize');

router.get('/', authJWT, authorize('admin', 'diretor', 'secretaria'), TeacherAssignmentController.index);
router.post('/sync', authJWT, authorize('admin', 'diretor', 'secretaria'), TeacherAssignmentController.sync);
router.delete('/:id', authJWT, authorize('admin'), TeacherAssignmentController.delete);

module.exports = router;
