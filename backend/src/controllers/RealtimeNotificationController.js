const RealtimeNotification = require('../models/RealtimeNotification');

exports.getMyNotifications = async (req, res) => {
    try {
        const receiverId = req.user.id || req.user._id;
        const notifications = await RealtimeNotification.find({ receiverId })
            .sort({ createdAt: -1 })
            .limit(50)
            .lean();
        
        const unreadCount = await RealtimeNotification.countDocuments({ receiverId, read: false });

        res.json({ success: true, data: notifications, unreadCount });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};

exports.markAsRead = async (req, res) => {
    try {
        const { id } = req.params;
        const receiverId = req.user.id || req.user._id;

        const notification = await RealtimeNotification.findOneAndUpdate(
            { _id: id, receiverId },
            { read: true },
            { new: true }
        );

        if (!notification) {
            return res.status(404).json({ success: false, error: 'Notificação não encontrada.' });
        }

        const unreadCount = await RealtimeNotification.countDocuments({ receiverId, read: false });

        if (global.io) {
            global.io.to(`user:${receiverId}`).emit('notification:count', { unreadCount });
        }

        res.json({ success: true, data: notification, unreadCount });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};

exports.markAllAsRead = async (req, res) => {
    try {
        const receiverId = req.user.id || req.user._id;
        await RealtimeNotification.updateMany({ receiverId, read: false }, { read: true });

        if (global.io) {
            global.io.to(`user:${receiverId}`).emit('notification:count', { unreadCount: 0 });
        }

        res.json({ success: true, message: 'Todas as notificações marcadas como lidas.' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};

// Helper: cria e emite notificação realtime
exports.createAndEmit = async ({ receiverId, receiverType, title, message, type, icon }) => {
    try {
        const notification = await RealtimeNotification.create({
            receiverId, receiverType, title, message, type: type || 'system', icon: icon || ''
        });

        if (global.io) {
            const unreadCount = await RealtimeNotification.countDocuments({ receiverId, read: false });
            global.io.to(`user:${receiverId}`).emit('notification:new', { notification, unreadCount });
        }

        return notification;
    } catch (error) {
        console.error('Erro ao criar notificação:', error.message);
        return null;
    }
};

/**
 * Salva uma nova inscrição de push notification para o usuário logado.
 */
exports.subscribe = async (req, res) => {
    try {
        const subscription = req.body;
        const usuarioId = req.user.id || req.user._id;

        const Usuario = require('../models/Usuario');
        await Usuario.findByIdAndUpdate(usuarioId, {
            $addToSet: { pushSubscriptions: subscription }
        });

        res.status(201).json({ success: true, message: 'Inscrição de push salva com sucesso.' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};

exports.getVapidPublicKey = async (req, res) => {
    try {
        const WebPushService = require('../services/WebPushService');
        res.json({ success: true, publicKey: WebPushService.getPublicKey() });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};
