const express = require('express');
const router = express.Router();
const RealtimeNotificationController = require('../controllers/RealtimeNotificationController');

router.get('/', RealtimeNotificationController.getMyNotifications);
router.put('/read/:id', RealtimeNotificationController.markAsRead);
router.put('/read-all', RealtimeNotificationController.markAllAsRead);
router.post('/subscribe', RealtimeNotificationController.subscribe);
router.get('/vapid-public-key', RealtimeNotificationController.getVapidPublicKey);

module.exports = router;
