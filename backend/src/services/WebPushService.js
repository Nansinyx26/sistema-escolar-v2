const webpush = require('web-push');
const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');

// As chaves VAPID identificam o servidor de forma estável. Se elas mudarem,
// TODAS as inscrições push existentes deixam de funcionar (o navegador as
// vinculou à chave pública antiga). Por isso a ordem de prioridade é:
//   1. Variáveis de ambiente (recomendado em produção)
//   2. Arquivo local persistido (evita regerar a cada reinício em dev)
//   3. Gerar e persistir uma vez
const KEYS_FILE = path.join(__dirname, '..', '..', 'vapid-keys.json');

const vapidKeys = {
    publicKey: process.env.VAPID_PUBLIC_KEY,
    privateKey: process.env.VAPID_PRIVATE_KEY
};

function isPlaceholder(v) {
    return !v || String(v).includes('...');
}

try {
    // Se as chaves não estão no ambiente (ou são placeholders de exemplo)
    if (isPlaceholder(vapidKeys.publicKey) || isPlaceholder(vapidKeys.privateKey)) {
        // Tenta reaproveitar chaves já persistidas em disco
        if (fs.existsSync(KEYS_FILE)) {
            try {
                const saved = JSON.parse(fs.readFileSync(KEYS_FILE, 'utf-8'));
                if (!isPlaceholder(saved.publicKey) && !isPlaceholder(saved.privateKey)) {
                    vapidKeys.publicKey = saved.publicKey;
                    vapidKeys.privateKey = saved.privateKey;
                    logger.info('🔑 [WebPush] Chaves VAPID carregadas de vapid-keys.json (persistidas).');
                }
            } catch (readErr) {
                logger.warn(`⚠️ [WebPush] Falha ao ler vapid-keys.json: ${readErr.message}`);
            }
        }

        // Ainda sem chaves válidas → gera uma vez e persiste para os próximos boots
        if (isPlaceholder(vapidKeys.publicKey) || isPlaceholder(vapidKeys.privateKey)) {
            logger.warn('⚠️ [WebPush] Chaves VAPID ausentes. Gerando e persistindo um par estável.');
            const generated = webpush.generateVAPIDKeys();
            vapidKeys.publicKey = generated.publicKey;
            vapidKeys.privateKey = generated.privateKey;
            try {
                fs.writeFileSync(KEYS_FILE, JSON.stringify(generated, null, 2), 'utf-8');
                logger.info('🔑 [WebPush] Novas chaves VAPID salvas em vapid-keys.json.');
            } catch (writeErr) {
                logger.warn(`⚠️ [WebPush] Não foi possível persistir as chaves (defina VAPID_* no ambiente): ${writeErr.message}`);
            }
        }
    }
    webpush.setVapidDetails(
        'mailto:contato@escolajaguari.com.br',
        vapidKeys.publicKey,
        vapidKeys.privateKey
    );
} catch (err) {
    logger.error('❌ [WebPush] Erro crítico ao configurar chaves VAPID:', err.message);
}

exports.getPublicKey = () => {
    return vapidKeys.publicKey;
};

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
