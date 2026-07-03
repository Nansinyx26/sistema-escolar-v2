const mongoose = require('mongoose');

const RealtimeNotificationSchema = new mongoose.Schema({
    receiverId: { type: mongoose.Schema.Types.ObjectId, ref: 'Usuario', required: true, index: true },
    receiverType: { type: String, enum: ['professor', 'diretor', 'admin', 'responsavel'], required: true },
    title: { type: String, required: true },
    message: { type: String, required: true },
    type: { type: String, enum: ['reaction', 'review', 'system', 'message', 'alert'], default: 'system' },
    icon: { type: String, default: '' },
    linkUrl: { type: String, default: '' },
    read: { type: Boolean, default: false },
    createdAt: { type: Date, default: Date.now }
});

// Auto-cleanup: remove notificações com mais de 30 dias
RealtimeNotificationSchema.index({ createdAt: 1 }, { expireAfterSeconds: 2592000 });

module.exports = mongoose.model('RealtimeNotification', RealtimeNotificationSchema, 'realtimeNotifications');
