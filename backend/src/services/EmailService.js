const logger = require('../utils/logger');
const { enviarEmail } = require('./EnvioEmail');
const { htmlResumoMensal } = require('./EmailResumoMensal');
const { htmlNotificacao } = require('./EmailNotificacao');

// ============================================================================
// O transporte local foi REMOVIDO em favor de services/EnvioEmail.js.
//
// O default daqui era `smtp.mailtrap.io:2525` — um capturador de e-mail de
// desenvolvimento. Sem EMAIL_HOST definido, toda mensagem deste arquivo era
// entregue a um servidor de testes e NUNCA chegava ao destinatário real, sem
// erro nenhum. Era a mais silenciosa das cinco configurações divergentes de
// e-mail que existiam no projeto.
//
// O remetente também era fixo em `sistema@escolajaguari.com.br`, ignorando
// EMAIL_FROM. Provedores recusam remetente de domínio não verificado, então o
// endereço agora vem da configuração, num lugar só.
// ============================================================================

/**
 * Envia um e-mail de notificação formatado.
 * `opcoes.tipo === 'atualizacao_sistema'` com `opcoes.resumo` usa o layout do
 * resumo mensal (services/EmailResumoMensal.js); o resto usa a mesma arte em
 * versão de aviso único (services/EmailNotificacao.js). `opcoes.categoria` e
 * `opcoes.prioridade` escolhem a cor e o ícone.
 */
exports.sendNotificationEmail = async (to, subject, title, summary, link, opcoes = {}) => {
    if (opcoes.tipo === 'atualizacao_sistema' && opcoes.resumo) {
        const base = process.env.FRONTEND_URL || 'http://localhost:3000';
        const html = htmlResumoMensal(opcoes.resumo, link, base);
        const r = await enviarEmail(to, subject, html);
        if (!r.ok)
            logger.error(`[EmailService] Resumo mensal não entregue (${r.etapa}): ${r.erro}`);
        return r.ok;
    }

    const html = htmlNotificacao({
        titulo: title,
        mensagem: summary,
        link,
        base: process.env.FRONTEND_URL || 'http://localhost:3000',
        tipo: opcoes.tipo,
        categoria: opcoes.categoria,
        prioridade: opcoes.prioridade,
    });

    const r = await enviarEmail(to, `[Notificação] ${subject}`, html);
    if (!r.ok) logger.error(`[EmailService] Notificação não entregue (${r.etapa}): ${r.erro}`);
    return r.ok;
};

/**
 * Envia código de verificação para recuperação de senha.
 */
exports.sendVerificationCode = async (to, code, userName) => {
    const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #eee; border-radius: 10px; overflow: hidden;">
        <div style="background: #06b6d4; padding: 20px; text-align: center;">
            <h1 style="color: white; margin: 0; font-size: 24px;">Sistema Escolar</h1>
        </div>
        <div style="padding: 30px;">
            <h2 style="color: #333; margin-top: 0;">Recuperação de Senha</h2>
            <p style="color: #666; line-height: 1.6;">Olá, <strong>${userName}</strong>.</p>
            <p style="color: #666; line-height: 1.6;">Você solicitou a redefinição de sua senha. Use o código abaixo para prosseguir:</p>
            <div style="font-size: 36px; font-weight: bold; letter-spacing: 8px; background: #f4f4f4; padding: 16px 24px; border-radius: 6px; text-align: center; margin: 20px 0; color: #06b6d4;">
                ${code}
            </div>
            <p style="color: #666; line-height: 1.6;">Este código expira em 15 minutos. Se você não solicitou esta alteração, desconsidere este e-mail.</p>
            <p style="color:#b45309;font-size:12px;background:#fffbeb;border-left:3px solid #f59e0b;padding:10px 12px;margin-top:20px;border-radius:0 4px 4px 0;"><strong>Não clique em "Cancelar inscricao".</strong> Este é um e-mail do sistema, não é propaganda. Cancelando, voce deixa de receber os códigos e fica sem conseguir entrar.</p>
            <p style="color: #999; font-size: 12px; margin-top: 40px; text-align: center;">
                Este é um e-mail automático. Por favor, não responda.
            </p>
        </div>
    </div>
    `;

    const r = await enviarEmail(to, 'Código de recuperação de senha — Sistema Escolar', html);
    if (!r.ok)
        logger.error(`[EmailService] Código de recuperação não entregue (${r.etapa}): ${r.erro}`);
    return r.ok;
};
