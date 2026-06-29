const express = require('express');
const router = express.Router();
const UserController = require('../controllers/UserController');
const authorize = require('../middleware/authorize');

router.get('/', authorize('admin', 'diretor'), UserController.list);
router.post('/', authorize('admin'), UserController.create);

// Upload / remoção de foto de perfil (usuário autenticado)
router.put('/foto', UserController.uploadFoto);
router.delete('/foto', UserController.removeFoto);

router.put('/:id', UserController.update);
router.delete('/:id', authorize('admin'), UserController.delete);
router.put('/:id/anonymize', authorize('admin'), UserController.anonymize);

module.exports = router;
