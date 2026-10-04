/**
 * emailNotifications.js — Notificações por E-mail (Roadmap #9)
 * ============================================
 * Templates de e-mail reutilizáveis para eventos do sistema.
 *
 * Funções exportadas:
 *   notificarBruteForce(adminEmails, emailAlvo, tentativas)
 *   notificarRotacaoCodigo(adminEmails, novoCodigo, autor)
 *   notificarVerificacaoEmail(email, nome, url)
 *   notificarPedidoTrocaEmail(novoEmail, nome, url, validadeHoras)
 *   notificarEmailTrocado(antigoEmail, nome, novoMascarado)
 *
 * USO: require('./emailNotifications')
 */

// Transporte centralizado em services/EnvioEmail.js — este arquivo mantinha a
// terceira cópia de `createTransport` do projeto. O remetente também sai de lá:
// o default `noreply@escola.com` que existia aqui é um domínio não verificado,
// e Resend/Brevo recusam a mensagem inteira por causa dele.
const { enviarEmail } = require('../services/EnvioEmail');
const { sanitizeInput } = require('./sanitize');

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
        await enviarEmail(
            adminEmails.join(', '),
            `[SEGURANÇA] Tentativa de brute force detectada — ${emailAlvo}`,
            html
        );
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
        await enviarEmail(
            adminEmails.join(', '),
            `Novo código secreto da escola: ${novoCodigo}`,
            html
        );
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
        await enviarEmail(email, `Confirme seu e-mail — ${APP_NAME}`, html);
    } catch (err) {
        console.error('[NOTIF] Erro ao enviar e-mail de verificação:', err.message);
        console.log(`🔗 [DESENVOLVIMENTO] Link de ativação de e-mail: ${tokenUrl}`);
    }
}

// --------------------------------------------------
// Troca de e-mail da conta (Issue #609)
// --------------------------------------------------
// O nome vem da própria conta e entra no HTML: sem limpar, um nome com tag
// virava conteúdo do e-mail. Nenhum dos dois loga o link — ele é a prova de
// posse do endereço.

/** Link de confirmação, enviado ao endereço NOVO. Devolve o `{ ok }` do envio. */
async function notificarPedidoTrocaEmail(novoEmail, nome, url, validadeHoras) {
    const nomeSeguro = sanitizeInput(String(nome || ''));
    const corpo = `
        <p style="color:#333;">Olá${nomeSeguro ? `, <strong>${nomeSeguro}</strong>` : ''}!</p>
        <p style="color:#555;">Recebemos um pedido para que este endereço passe a ser o e-mail da sua conta no ${APP_NAME}.</p>
        <p style="color:#555;">Para confirmar, abra o link <strong>no aparelho em que você está conectado à conta</strong> e toque em "Confirmar troca".</p>
        <div style="text-align:center;margin:24px 0;">
            <a href="${url}"
               style="display:inline-block;padding:14px 32px;background:#1a56db;color:#fff;text-decoration:none;border-radius:8px;font-size:1rem;font-weight:600;">
                Confirmar o novo e-mail
            </a>
        </div>
        <p style="color:#888;font-size:0.85rem;">Link direto: <a href="${url}" style="color:#1a56db;">${url}</a></p>
        <p style="color:#aaa;font-size:0.8rem;margin-top:16px;">O link vale por <strong>${validadeHoras} horas</strong>. Se você não pediu esta troca, ignore este e-mail: nada muda sem a confirmação.</p>
    `;
    const html = templateBase('Confirme o novo e-mail', '#1a56db', '✉️', corpo);
    return enviarEmail(novoEmail, `Confirme o novo e-mail da sua conta — ${APP_NAME}`, html);
}

/** Aviso ao endereço ANTIGO depois da troca, com o caminho caso não tenha sido a pessoa. */
async function notificarEmailTrocado(antigoEmail, nome, novoMascarado) {
    const nomeSeguro = sanitizeInput(String(nome || ''));
    const corpo = `
        <p style="color:#333;">Olá${nomeSeguro ? `, <strong>${nomeSeguro}</strong>` : ''}.</p>
        <p style="color:#555;">O e-mail da sua conta no ${APP_NAME} foi trocado para <strong>${sanitizeInput(String(novoMascarado || ''))}</strong>. A partir de agora, o login e os avisos usam o endereço novo.</p>
        <table style="background:#fff3cd;border:1px solid #ffc107;border-radius:8px;padding:16px 20px;margin:16px 0;width:100%;">
            <tr><td style="color:#7a5b00;">
                <strong>Não foi você?</strong> Procure a secretaria da escola o quanto antes: ela consegue devolver a conta ao seu endereço.
            </td></tr>
        </table>
    `;
    const html = templateBase('O e-mail da sua conta mudou', '#b45309', '🔔', corpo);
    return enviarEmail(antigoEmail, `O e-mail da sua conta foi trocado — ${APP_NAME}`, html);
}

module.exports = {
    notificarBruteForce,
    notificarRotacaoCodigo,
    notificarVerificacaoEmail,
    notificarPedidoTrocaEmail,
    notificarEmailTrocado,
};
