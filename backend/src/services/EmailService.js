const logger = require('../utils/logger');
const { enviarEmail } = require('./EnvioEmail');

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

function escaparHtml(texto) {
    return String(texto ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

// Paleta black & mint do resumo mensal.
const COR = {
    pagina: '#050807',
    cartao: '#0b100e',
    item: '#121a17',
    borda: '#1c2823',
    mint: '#5ef2c1',
    mintSuave: '#b8f7e1',
    texto: '#e8f3ee',
    apagado: '#7f948c',
};

const GRUPOS_ATUALIZACAO = [
    { rotulo: 'Novidade', titulo: 'Novidades', cor: COR.mint },
    { rotulo: 'Melhoria', titulo: 'Melhorias', cor: '#2dd4bf' },
    { rotulo: 'Correção', titulo: 'Correções', cor: '#c9d6d0' },
];

/**
 * Lê a mensagem do resumo mensal (config/changelog.js#montarResumoMensal):
 * primeira linha é a introdução, as linhas `• Rótulo: texto` são os itens.
 */
function lerResumo(mensagem) {
    const linhas = String(mensagem || '')
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean);
    const intro = linhas.find((l) => !l.startsWith('•')) || '';
    const itens = linhas
        .filter((l) => l.startsWith('•'))
        .map((l) => {
            const texto = l.replace(/^•\s*/, '');
            const grupo = GRUPOS_ATUALIZACAO.find((g) => texto.startsWith(`${g.rotulo}:`));
            return grupo
                ? { grupo, texto: texto.slice(grupo.rotulo.length + 1).trim() }
                : { grupo: GRUPOS_ATUALIZACAO[1], texto };
        });
    return { intro, itens };
}

/**
 * HTML do resumo mensal de novidades. Tabelas e estilo inline: é o que Gmail,
 * Outlook e os apps de celular renderizam do mesmo jeito.
 */
function htmlResumoAtualizacao(title, mensagem, link) {
    const { intro, itens } = lerResumo(mensagem);
    const mes = title.includes('—') ? title.split('—').pop().trim() : '';

    const contagem = GRUPOS_ATUALIZACAO.map((g) => ({
        g,
        n: itens.filter((i) => i.grupo === g).length,
    })).filter((c) => c.n > 0);
    const chips = contagem
        .map(
            ({ g, n }) =>
                `<span style="display:inline-block;margin:0 6px 6px 0;padding:5px 11px;border-radius:999px;border:1px solid ${COR.borda};background:${COR.item};color:${g.cor};font-size:12px;font-weight:600;">${n} ${n === 1 ? g.rotulo.toLowerCase() : g.titulo.toLowerCase()}</span>`
        )
        .join('');

    const secoes = contagem
        .map(({ g }) => {
            const linhas = itens
                .filter((i) => i.grupo === g)
                .map(
                    (i) => `
                <tr><td style="padding:0 0 8px 0;">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${COR.item};border:1px solid ${COR.borda};border-left:3px solid ${g.cor};border-radius:10px;">
                        <tr><td style="padding:13px 16px;font-size:15px;line-height:22px;color:${COR.texto};">${escaparHtml(i.texto)}</td></tr>
                    </table>
                </td></tr>`
                )
                .join('');
            return `
            <tr><td style="padding:18px 0 10px 0;font-size:11px;font-weight:700;letter-spacing:1.6px;text-transform:uppercase;color:${g.cor};">${g.titulo}</td></tr>
            ${linhas}`;
        })
        .join('');

    return `
    <div style="background:${COR.pagina};padding:36px 12px;font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
        <div style="display:none;max-height:0;overflow:hidden;">${escaparHtml(intro)}</div>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;margin:0 auto;background:${COR.cartao};border:1px solid ${COR.borda};border-radius:16px;overflow:hidden;">
            <tr><td style="height:4px;line-height:4px;font-size:0;background:${COR.mint};">&nbsp;</td></tr>
            <tr>
                <td style="padding:32px 32px 8px 32px;">
                    <div style="color:${COR.mint};font-size:12px;font-weight:700;letter-spacing:2px;text-transform:uppercase;">Sistema Escolar &nbsp;·&nbsp; Resumo mensal</div>
                    <div style="color:#ffffff;font-size:30px;line-height:36px;font-weight:800;margin-top:12px;">O que há de novo</div>
                    ${mes ? `<div style="color:${COR.mintSuave};font-size:16px;margin-top:4px;">${escaparHtml(mes)}</div>` : ''}
                    <div style="margin-top:20px;">${chips}</div>
                </td>
            </tr>
            <tr>
                <td style="padding:8px 32px 8px 32px;">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${secoes}</table>
                </td>
            </tr>
            <tr>
                <td align="center" style="padding:24px 32px 36px 32px;">
                    <a href="${escaparHtml(link)}" style="display:inline-block;background:${COR.mint};color:#04110c;font-size:15px;font-weight:700;text-decoration:none;padding:14px 32px;border-radius:10px;">Acessar o sistema &rarr;</a>
                </td>
            </tr>
            <tr>
                <td style="border-top:1px solid ${COR.borda};padding:20px 32px;text-align:center;font-size:12px;line-height:18px;color:${COR.apagado};">
                    Você recebe este resumo uma vez por mês, no dia 1.<br>
                    Este é um e-mail automático. Por favor, não responda.
                </td>
            </tr>
        </table>
    </div>
    `;
}

/**
 * Envia um e-mail de notificação formatado.
 * `opcoes.tipo === 'atualizacao_sistema'` usa o layout do resumo mensal.
 */
exports.sendNotificationEmail = async (to, subject, title, summary, link, opcoes = {}) => {
    if (opcoes.tipo === 'atualizacao_sistema') {
        const html = htmlResumoAtualizacao(title, summary, link);
        const r = await enviarEmail(to, subject, html);
        if (!r.ok)
            logger.error(`[EmailService] Resumo mensal não entregue (${r.etapa}): ${r.erro}`);
        return r.ok;
    }

    const html = `
    <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #eee; border-radius: 10px; overflow: hidden;">
        <div style="background: #06b6d4; padding: 20px; text-align: center;">
            <h1 style="color: white; margin: 0; font-size: 24px;">Sistema Escolar</h1>
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

exports.htmlResumoAtualizacao = htmlResumoAtualizacao;
