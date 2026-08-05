const express = require('express');
const router = express.Router();
const DirectorController = require('../controllers/DirectorController');
const authorize = require('../middleware/authorize');

router.get('/', authorize('admin', 'diretor'), DirectorController.list);
router.get('/:id', authorize('admin', 'diretor'), DirectorController.get);
router.post('/', authorize('admin', 'diretor'), DirectorController.create);
router.put('/:id', authorize('admin', 'diretor'), DirectorController.update);
router.delete('/:id', authorize('admin'), DirectorController.delete);

module.exports = router;
