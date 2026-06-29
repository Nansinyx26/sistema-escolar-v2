const express = require('express');
const router = express.Router();
const SiteReviewController = require('../controllers/SiteReviewController');

router.post('/', SiteReviewController.create);
router.get('/', SiteReviewController.getAll);
router.get('/stats', SiteReviewController.getStats);
router.get('/mine', SiteReviewController.getMine);
router.delete('/', SiteReviewController.remove);

module.exports = router;
