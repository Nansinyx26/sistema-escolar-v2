const express = require('express');
const router = express.Router();
const SecurityController = require('../controllers/SecurityController');
const authorize = require('../middleware/authorize');

router.get('/status', authorize('admin', 'diretor'), (req, res) => SecurityController.getStatus(req, res));
router.post('/rotate', authorize('admin', 'diretor'), (req, res) => SecurityController.forceRotate(req, res));
router.post('/director-code', authorize('admin', 'diretor'), (req, res) => SecurityController.forceRotate(req, res));

module.exports = router;
