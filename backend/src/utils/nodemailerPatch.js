const nodemailer = require('nodemailer');
const https = require('https');

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
            console.log(`🚀 [Nodemailer Patch] Brevo detectado no host. Enviando via API HTTP (porta 443) para contornar o bloqueio SMTP do Render.`);

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
                        try { resJson = JSON.parse(data); } catch (e) {}
                        if (res.statusCode >= 200 && res.statusCode < 300) {
                            console.log('✅ [Nodemailer Patch] E-mail enviado com sucesso via Brevo HTTP API! ID:', resJson.messageId);
                            resolve({ messageId: resJson.messageId });
                        } else {
                            console.error('❌ [Nodemailer Patch] Erro na API do Brevo:', resJson);
                            reject(new Error(resJson.message || `HTTP ${res.statusCode}`));
                        }
                    });
                });

                req.on('error', (err) => {
                    console.error('❌ [Nodemailer Patch] Falha HTTP na requisição para Brevo:', err);
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

console.log('🛡️ [Nodemailer Patch] Brevo HTTP API bypass active.');
