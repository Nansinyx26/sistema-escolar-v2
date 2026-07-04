const express = require('express');
const router = express.Router();
const NoteController = require('../controllers/NoteController');
const authorize = require('../middleware/authorize');

router.get('/', NoteController.list);
router.post('/', authorize('admin', 'diretor', 'secretaria', 'professor'), NoteController.create);
router.get('/media/:alunoId', NoteController.getMedia);
router.get('/boletim/:alunoId', NoteController.getBoletim);
router.get('/:id', NoteController.get);
router.put('/:id', authorize('admin', 'diretor', 'secretaria', 'professor'), NoteController.update);
router.delete('/:id', authorize('admin', 'diretor'), NoteController.delete);

module.exports = router;
