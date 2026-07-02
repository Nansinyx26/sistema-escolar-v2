const express = require('express');
const router = express.Router();
const StudentController = require('../controllers/StudentController');
const authorize = require('../middleware/authorize');

router.get('/codigos-secretos', authorize('admin', 'diretor', 'secretaria'), StudentController.listSecretCodes);
router.get('/', StudentController.list);
router.get('/:id', StudentController.get);
router.post('/', StudentController.create);
router.put('/:id', StudentController.update);
router.delete('/:id', authorize('admin', 'diretor', 'secretaria'), StudentController.delete);

module.exports = router;
