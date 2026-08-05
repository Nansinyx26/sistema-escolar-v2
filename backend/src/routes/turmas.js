const express = require('express');
const router = express.Router();
const ClassController = require('../controllers/ClassController');
const authorize = require('../middleware/authorize');

router.get('/', ClassController.list);
router.post('/', authorize('admin', 'diretor', 'secretaria'), ClassController.create);
router.delete('/:id', authorize('admin'), ClassController.delete);

module.exports = router;
