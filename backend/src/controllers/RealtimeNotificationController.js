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
exports.createAndEmit = async ({
    receiverId,
    receiverType,
    title,
    message,
    type,
    icon,
    escolaId,
}) => {
    try {
        const notification = await RealtimeNotification.create({
            receiverId,
            receiverType,
            title,
            message,
            type: type || 'system',
            icon: icon || '',
            // Quem chama sabe de que escola é a notificação; só faltava o
            // parâmetro atravessar até o create.
            escolaId: escolaId ? String(escolaId) : undefined,
        });

        if (global.io) {
            const unreadCount = await RealtimeNotification.countDocuments({
                receiverId,
                read: false,
            });
            global.io
                .to(`user:${receiverId}`)
                .emit('notification:new', { notification, unreadCount });
        }

        return notification;
    } catch (error) {
        console.error('Erro ao criar notificação:', error.message);
        return null;
    }
};

/**
 * Reduz o corpo recebido ao formato de uma PushSubscription válida, ou `null`.
 * Antes o corpo inteiro ia para o banco — qualquer JSON virava "inscrição" e o
 * envio falhava depois, a cada aviso.
 */
function normalizarInscricao(body) {
    if (!body || typeof body !== 'object') return null;
    const { endpoint, keys, expirationTime } = body;
    if (typeof endpoint !== 'string' || endpoint.length > 2048) return null;
    let url;
    try {
        url = new URL(endpoint);
    } catch {
        return null;
    }
    if (url.protocol !== 'https:') return null;
    if (!keys || typeof keys.p256dh !== 'string' || typeof keys.auth !== 'string') return null;
    if (!keys.p256dh || !keys.auth || keys.p256dh.length > 256 || keys.auth.length > 256)
        return null;

    const inscricao = { endpoint, keys: { p256dh: keys.p256dh, auth: keys.auth } };
    if (typeof expirationTime === 'number') inscricao.expirationTime = expirationTime;
    return inscricao;
}

/**
 * Salva uma nova inscrição de push notification para o usuário logado.
 */
exports.subscribe = async (req, res) => {
    try {
        const subscription = normalizarInscricao(req.body);
        if (!subscription) {
            return res.status(400).json({ success: false, error: 'Inscrição de push inválida.' });
        }
        const usuarioId = req.user.id || req.user._id;

        // `$addToSet` compara o subdocumento inteiro: as mesmas chaves em outra
        // ordem (ou com `expirationTime` a mais) viravam uma segunda inscrição
        // do mesmo aparelho, e cada aviso chegava duplicado. A identidade de
        // uma inscrição é o `endpoint` — sai a antiga, entra a atual.
        const Usuario = require('../models/Usuario');
        await Usuario.updateOne(
            { _id: usuarioId },
            { $pull: { pushSubscriptions: { endpoint: subscription.endpoint } } }
        );
        await Usuario.updateOne({ _id: usuarioId }, { $push: { pushSubscriptions: subscription } });

        res.status(201).json({ success: true, message: 'Inscrição de push salva com sucesso.' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};

exports.getVapidPublicKey = async (_req, res) => {
    try {
        const WebPushService = require('../services/WebPushService');
        res.json({ success: true, publicKey: WebPushService.getPublicKey() });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};
