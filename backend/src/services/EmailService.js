const nodemailer = require('nodemailer');
const logger = require('../utils/logger');

const transporter = nodemailer.createTransport({
    host: process.env.EMAIL_HOST || 'smtp.mailtrap.io',
    port: process.env.EMAIL_PORT || 2525,
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
});

/**
 * Envia um e-mail de notificação formatado.
 */
exports.sendNotificationEmail = async (to, subject, title, summary, link) => {
    const html = `
    <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #eee; border-radius: 10px; overflow: hidden;">
        <div style="background: #06b6d4; padding: 20px; text-align: center;">
            <h1 style="color: white; margin: 0; font-size: 24px;">Escola Jaguari</h1>
        </div>
        <div style="padding: 30px;">
            <h2 style="color: #333; margin-top: 0;">${title}</h2>
            <p style="color: #666; line-height: 1.6;">${summary}</p>
            <div style="margin-top: 30px; text-align: center;">
                <a href="${link}" style="background: #06b6d4; color: white; padding: 12px 25px; text-decoration: none; border-radius: 5px; font-weight: bold; display: inline-block;">
                    Abrir no Portal
                </a>
            </div>
            <p style="color: #999; font-size: 12px; margin-top: 40px; text-align: center;">
                Este é um e-mail automático. Por favor, não responda.
            </p>
        </div>
    </div>
    `;

    try {
        await transporter.sendMail({
            from: '"Escola Jaguari" <sistema@escolajaguari.com.br>',
            to,
            subject: `[Notificação] ${subject}`,
            html
        });
        return true;
    } catch (error) {
        logger.error(`Error sending email: ${error.message}`);
        return false;
    }
};

/**
 * Envia código de verificação para recuperação de senha.
 */
exports.sendVerificationCode = async (to, code, userName) => {
    const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #eee; border-radius: 10px; overflow: hidden;">
        <div style="background: #06b6d4; padding: 20px; text-align: center;">
            <h1 style="color: white; margin: 0; font-size: 24px;">Escola Jaguari</h1>
        </div>
        <div style="padding: 30px;">
            <h2 style="color: #333; margin-top: 0;">Recuperação de Senha</h2>
            <p style="color: #666; line-height: 1.6;">Olá, <strong>${userName}</strong>.</p>
            <p style="color: #666; line-height: 1.6;">Você solicitou a redefinição de sua senha. Use o código abaixo para prosseguir:</p>
            <div style="font-size: 36px; font-weight: bold; letter-spacing: 8px; background: #f4f4f4; padding: 16px 24px; border-radius: 6px; text-align: center; margin: 20px 0; color: #06b6d4;">
                ${code}
            </div>
            <p style="color: #666; line-height: 1.6;">Este código expira em 15 minutos. Se você não solicitou esta alteração, desconsidere este e-mail.</p>
            <p style="color: #999; font-size: 12px; margin-top: 40px; text-align: center;">
                Este é um e-mail automático. Por favor, não responda.
            </p>
        </div>
    </div>
    `;

    try {
        await transporter.sendMail({
            from: '"Escola Jaguari" <sistema@escolajaguari.com.br>',
            to,
            subject: '🔐 Código de recuperação de senha — Escola Jaguari',
            html
        });
        return true;
    } catch (error) {
        logger.error(`Error sending recovery email: ${error.message}`);
        return false;
    }
};
