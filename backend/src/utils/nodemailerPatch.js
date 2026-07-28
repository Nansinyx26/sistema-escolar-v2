const nodemailer = require('nodemailer');
const https = require('https');
const logger = require('./logger');

// Salva o createTransport original do nodemailer
const originalCreateTransport = nodemailer.createTransport;

nodemailer.createTransport = function(...args) {
    const transporter = originalCreateTransport.apply(this, args);
    const originalSendMail = transporter.sendMail;

    // Sobrescreve o sendMail deste transporter
    transporter.sendMail = async function(mailOptions, callback) {
        const host = process.env.EMAIL_HOST || '';
        const pass = process.env.EMAIL_PASS || '';
        const fromStr = mailOptions.from || process.env.EMAIL_FROM || 'Sistema Escolar <oliversinyxcontato@gmail.com>';

        // Se o Host for do Brevo e tiver a API Key no EMAIL_PASS, redireciona via HTTP API
        if (host.includes('brevo') && pass && (pass.startsWith('xsmtpsib-') || pass.startsWith('xkeysib-'))) {
            logger.debug('🚀 [Nodemailer Patch] Brevo detectado — enviando via API HTTP (contorna bloqueio SMTP do Render)', { action: 'email.enviar' });

            // Extrai nome e e-mail do remetente (FROM)
            let senderName = 'Sistema Escolar';
            let senderEmail = 'oliversinyxcontato@gmail.com';
            const fromMatch = fromStr.match(/^(.*?)\s*<(.*?)>$/);
            if (fromMatch) {
                senderName = fromMatch[1].replace(/['"]/g, '').trim();
                senderEmail = fromMatch[2].trim();
            }

            // Normaliza destinatários (TO)
            let toEmails = [];
            if (typeof mailOptions.to === 'string') {
                toEmails = mailOptions.to.split(',').map(emailStr => {
                    const toMatch = emailStr.match(/^(.*?)\s*<(.*?)>$/);
                    if (toMatch) {
                        return { name: toMatch[1].replace(/['"]/g, '').trim(), email: toMatch[2].trim() };
                    }
                    return { email: emailStr.trim(), name: 'Usuário' };
                });
            } else if (Array.isArray(mailOptions.to)) {
                toEmails = mailOptions.to.map(t => {
                    if (typeof t === 'string') {
                        const toMatch = t.match(/^(.*?)\s*<(.*?)>$/);
                        if (toMatch) {
                            return { name: toMatch[1].replace(/['"]/g, '').trim(), email: toMatch[2].trim() };
                        }
                        return { email: t.trim(), name: 'Usuário' };
                    }
                    return { email: t.email, name: t.name || 'Usuário' };
                });
            }

            const postData = JSON.stringify({
                sender: { name: senderName, email: senderEmail },
                to: toEmails,
                subject: mailOptions.subject,
                htmlContent: mailOptions.html || mailOptions.text
            });

            const sendPromise = new Promise((resolve, reject) => {
                const req = https.request({
                    hostname: 'api.brevo.com',
                    port: 443,
                    path: '/v3/smtp/email',
                    method: 'POST',
                    headers: {
                        'api-key': pass,
                        'Content-Type': 'application/json',
                        'Accept': 'application/json',
                        'Content-Length': Buffer.byteLength(postData)
                    }
                }, (res) => {
                    let data = '';
                    res.on('data', (chunk) => data += chunk);
                    res.on('end', () => {
                        let resJson = {};
                        try {
                            resJson = JSON.parse(data);
                        } catch (e) {
                            // Resposta não-JSON (HTML de erro do proxy, corpo vazio):
                            // sem isto, o motivo real vira "HTTP 500" sem explicação.
                            logger.warn('[Nodemailer Patch] Resposta da Brevo não é JSON', {
                                status: res.statusCode, amostra: String(data).slice(0, 200),
                                action: 'email.enviar',
                            });
                        }
                        if (res.statusCode >= 200 && res.statusCode < 300) {
                            logger.info('✅ [Nodemailer Patch] E-mail enviado via Brevo HTTP API', { messageId: resJson.messageId, action: 'email.enviar' });
                            resolve({ messageId: resJson.messageId });
                        } else {
                            logger.error('❌ [Nodemailer Patch] Erro na API do Brevo', { status: res.statusCode, resposta: resJson, action: 'email.enviar' });
                            reject(new Error(resJson.message || `HTTP ${res.statusCode}`));
                        }
                    });
                });

                req.on('error', (err) => {
                    logger.error('❌ [Nodemailer Patch] Falha HTTP na requisição para Brevo', { err, action: 'email.enviar' });
                    reject(err);
                });

                req.write(postData);
                req.end();
            });

            if (callback) {
                sendPromise.then(info => callback(null, info)).catch(err => callback(err));
            }
            return sendPromise;
        }

        // Caso contrário, continua usando o SMTP normal (padrão)
        return originalSendMail.call(this, mailOptions, callback);
    };

    return transporter;
};

logger.debug('🛡️ [Nodemailer Patch] Brevo HTTP API bypass ativo.');
