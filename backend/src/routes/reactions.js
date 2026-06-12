const express = require('express');
const router = express.Router();
const ReactionController = require('../controllers/ReactionController');
const authJWT = require('../middleware/authJWT');

router.post('/', authJWT, ReactionController.addOrUpdate);
router.delete('/:messageId', authJWT, ReactionController.remove);
router.get('/message/:messageId', authJWT, ReactionController.getByMessage);

module.exports = router;
