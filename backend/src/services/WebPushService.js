const webpush = require('web-push');
const logger = require('../utils/logger');

// Você deve gerar essas chaves uma única vez no ambiente de produção
// webpush.generateVAPIDKeys();
const vapidKeys = {
    publicKey: process.env.VAPID_PUBLIC_KEY,
    privateKey: process.env.VAPID_PRIVATE_KEY
};

try {
    // Se as chaves não estão configuradas ou são placeholders de exemplo
    if (!vapidKeys.publicKey || vapidKeys.publicKey.includes('...') || !vapidKeys.privateKey || vapidKeys.privateKey.includes('...')) {
        logger.warn('⚠️ [WebPush] Chaves VAPID ausentes ou inválidas. Gerando chaves temporárias para desenvolvimento/testes.');
        const generated = webpush.generateVAPIDKeys();
        vapidKeys.publicKey = generated.publicKey;
        vapidKeys.privateKey = generated.privateKey;
    }
    webpush.setVapidDetails(
        'mailto:contato@escolajaguari.com.br',
        vapidKeys.publicKey,
        vapidKeys.privateKey
    );
} catch (err) {
    logger.error('❌ [WebPush] Erro crítico ao configurar chaves VAPID:', err.message);
}

/**
 * Envia uma notificação push para uma inscrição específica.
 */
exports.sendPushNotification = async (subscription, payload) => {
    try {
        await webpush.sendNotification(subscription, JSON.stringify(payload));
        return true;
    } catch (error) {
        if (error.statusCode === 404 || error.statusCode === 410) {
            // Inscrição expirada ou inválida
            logger.warn(`Push subscription expired: ${error.message}`);
            return 'expired';
        }
        logger.error(`Error sending push: ${error.message}`);
        return false;
    }
};
