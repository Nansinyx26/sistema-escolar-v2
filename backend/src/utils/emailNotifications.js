/**
 * emailNotifications.js — Notificações por E-mail (Roadmap #9)
 * ============================================
 * Templates de e-mail reutilizáveis para eventos do sistema.
 *
 * Funções exportadas:
 *   notificarBruteForce(adminEmails, emailAlvo, tentativas)
 *   notificarRotacaoCodigo(adminEmails, novoCodigo, autor)
 *   notificarVerificacaoEmail(email, nome, url)
 *
 * USO: require('./emailNotifications')
 */

const nodemailer = require('nodemailer');

// Reutiliza config de e-mail do sistema
const isResend = !process.env.EMAIL_HOST || process.env.EMAIL_HOST === 'smtp.resend.com';
const transporter = nodemailer.createTransport({
    host: process.env.EMAIL_HOST || 'smtp.resend.com',
    port: parseInt(process.env.EMAIL_PORT) || (isResend ? 465 : 587),
    secure: isResend,
    auth: {
        user: isResend ? 'resend' : process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
});

const FROM = process.env.EMAIL_FROM || '"Sistema Escolar" <noreply@escola.com>';
const APP_NAME = 'Sistema Escolar';

// --------------------------------------------------
// Template base HTML para todos os e-mails
// --------------------------------------------------
function templateBase(titulo, corHeader, icone, corpo) {
    return `<!DOCTYPE html>
<html lang="pt-BR">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;padding:32px 0;">
    <tr><td align="center">
      <table width="520" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.1);">
        <!-- Header -->
        <tr><td style="background:${corHeader};padding:28px 32px;text-align:center;">
          <div style="font-size:2.5rem;margin-bottom:8px;">${icone}</div>
          <h1 style="color:#fff;margin:0;font-size:1.3rem;font-weight:700;">${titulo}</h1>
        </td></tr>
        <!-- Body -->
        <tr><td style="padding:32px;">${corpo}</td></tr>
        <!-- Footer -->
        <tr><td style="background:#f8f8f8;padding:16px 32px;text-align:center;border-top:1px solid #eee;">
          <p style="color:#aaa;font-size:0.75rem;margin:0;">${APP_NAME} &mdash; E-mail automático. Não responda.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

// --------------------------------------------------
// Notifica admins sobre tentativa de brute force
// Chamado pelo UserController quando conta é bloqueada
// --------------------------------------------------
async function notificarBruteForce(adminEmails, emailAlvo, ip) {
    if (!adminEmails || !adminEmails.length) return;

    const corpo = `
        <p style="color:#333;">O sistema detectou múltiplas tentativas de login falhas e bloqueou temporariamente a conta:</p>
        <table style="background:#fff3cd;border:1px solid #ffc107;border-radius:8px;padding:16px 20px;margin:16px 0;width:100%;">
            <tr><td><strong>Conta alvo:</strong></td><td style="color:#d9534f;">${emailAlvo}</td></tr>
            <tr><td><strong>IP de origem:</strong></td><td><code>${ip || 'desconhecido'}</code></td></tr>
            <tr><td><strong>Hora:</strong></td><td>${new Date().toLocaleString('pt-BR')}</td></tr>
            <tr><td><strong>Status:</strong></td><td>Bloqueada por 15 minutos</td></tr>
        </table>
        <p style="color:#555;">Se esta atividade for suspeita, considere revisar os logs de auditoria e alterar as credenciais do usuário.</p>
        <a href="${process.env.FRONTEND_URL || 'http://localhost:3001'}/index.html"
           style="display:inline-block;padding:10px 24px;background:#1a56db;color:#fff;text-decoration:none;border-radius:6px;margin-top:8px;">
            Abrir Sistema
        </a>
    `;

    const html = templateBase('⚠️ Alerta de Segurança — Brute Force', '#dc3545', '🛡️', corpo);

    try {
        await transporter.sendMail({
            from: FROM,
            to: adminEmails.join(', '),
            subject: `⚠️ [SEGURANÇA] Tentativa de brute force detectada — ${emailAlvo}`,
            html
        });
        console.log(`📧 [NOTIF] Alerta brute force enviado para ${adminEmails.length} admin(s).`);
    } catch (err) {
        console.error('[NOTIF] Erro ao enviar alerta brute force:', err.message);
    }
}

// --------------------------------------------------
// Notifica admins quando o código secreto é rotacionado
// Chamado pelo SecurityController
// --------------------------------------------------
async function notificarRotacaoCodigo(adminEmails, novoCodigo, autor) {
    if (!adminEmails || !adminEmails.length) return;

    const corpo = `
        <p style="color:#333;">O código secreto da escola foi rotacionado.</p>
        <table style="background:#e8f4fd;border:1px solid #1a56db;border-radius:8px;padding:16px 20px;margin:16px 0;width:100%;">
            <tr><td><strong>Novo Código:</strong></td>
                <td style="font-size:1.5rem;font-weight:700;letter-spacing:0.5rem;color:#1a56db;">${novoCodigo}</td></tr>
            <tr><td><strong>Realizado por:</strong></td><td>${autor}</td></tr>
            <tr><td><strong>Hora:</strong></td><td>${new Date().toLocaleString('pt-BR')}</td></tr>
        </table>
        <p style="color:#555;font-size:0.9rem;">Comunique o novo código aos professores que precisam se cadastrar.</p>
    `;

    const html = templateBase('🔐 Código Secreto Rotacionado', '#1a56db', '🔑', corpo);

    try {
        await transporter.sendMail({
            from: FROM,
            to: adminEmails.join(', '),
            subject: `🔑 Novo código secreto da escola: ${novoCodigo}`,
            html
        });
        console.log(`📧 [NOTIF] Notificação de rotação de código enviada.`);
    } catch (err) {
        console.error('[NOTIF] Erro ao notificar rotação:', err.message);
    }
}

// --------------------------------------------------
// Envia e-mail de verificação de conta (Roadmap #7)
// Chamado pelo UserController após registerWithCode
// --------------------------------------------------
async function notificarVerificacaoEmail(email, nome, tokenUrl) {
    const corpo = `
        <p style="color:#333;">Olá, <strong>${nome}</strong>!</p>
        <p style="color:#555;">Sua conta foi criada com sucesso. Para ativá-la, confirme seu e-mail clicando no botão abaixo:</p>
        <div style="text-align:center;margin:24px 0;">
            <a href="${tokenUrl}"
               style="display:inline-block;padding:14px 32px;background:#16a34a;color:#fff;text-decoration:none;border-radius:8px;font-size:1rem;font-weight:600;">
                ✅ Verificar Meu E-mail
            </a>
        </div>
        <p style="color:#888;font-size:0.85rem;">Link direto: <a href="${tokenUrl}" style="color:#1a56db;">${tokenUrl}</a></p>
        <p style="color:#aaa;font-size:0.8rem;margin-top:16px;">Este link expira em <strong>24 horas</strong>. Se você não criou esta conta, ignore este e-mail.</p>
    `;

    const html = templateBase('Confirme seu E-mail', '#16a34a', '✅', corpo);

    try {
        await transporter.sendMail({
            from: FROM,
            to: email,
            subject: `✅ Confirme seu e-mail — ${APP_NAME}`,
            html
        });
        console.log(`📧 [NOTIF] E-mail de verificação enviado para ${email}`);
    } catch (err) {
        console.error('[NOTIF] Erro ao enviar e-mail de verificação:', err.message);
    }
}

module.exports = { notificarBruteForce, notificarRotacaoCodigo, notificarVerificacaoEmail };
