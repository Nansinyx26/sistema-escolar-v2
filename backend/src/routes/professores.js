const express = require('express');
const router = express.Router();
const TeacherController = require('../controllers/TeacherController');
const authorize = require('../middleware/authorize');

router.get('/', TeacherController.list);
router.get('/:id', TeacherController.get);
router.post('/', authorize('admin', 'diretor', 'professor'), TeacherController.create);
router.put('/:id', authorize('admin', 'diretor', 'professor'), TeacherController.update);
router.delete('/:id', authorize('admin'), TeacherController.delete);

module.exports = router;
