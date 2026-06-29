const express = require('express');
const router = express.Router();
const GradeHorariaController = require('../controllers/GradeHorariaController');
const authorize = require('../middleware/authorize');

router.post('/', authorize('admin', 'diretor'), GradeHorariaController.create);
router.get('/', GradeHorariaController.list);
router.delete('/:id', authorize('admin'), GradeHorariaController.delete);

module.exports = router;
