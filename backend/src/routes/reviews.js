const express = require('express');
const router = express.Router();
const SiteReviewController = require('../controllers/SiteReviewController');
const bloquearPalavroes = require('../middleware/bloquearPalavroes');

router.post('/', bloquearPalavroes('comment', { recurso: 'avaliacao-site' }), SiteReviewController.create);
router.get('/', SiteReviewController.getAll);
router.get('/stats', SiteReviewController.getStats);
router.get('/mine', SiteReviewController.getMine);
router.delete('/', SiteReviewController.remove);

module.exports = router;
