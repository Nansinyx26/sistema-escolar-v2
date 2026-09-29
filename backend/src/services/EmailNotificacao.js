/**
 * HTML do e-mail de cada notificação, com a mesma arte do "Resumo mensal"
 * (services/EmailResumoMensal.js): cabeçalho escuro com logo e ondas, título
 * grande, chip do tipo, card com ícone e botão em degradê.
 *
 * Mesmas regras de cliente de e-mail: tabelas, estilo inline e só imagens PNG
 * de `img/email/` (Gmail e Outlook não exibem SVG).
 */

const { TIPOS, FONTE, escaparHtml, img } = require('./EmailResumoMensal');

const PRIORIDADE_ALTA = new Set(['alta', 'urgente', 'importante']);

/**
 * Escolhe cor, rótulo e ícone. As cores são as três do resumo mensal:
 * menta (aviso comum), azul (acadêmico/evento/resumo) e roxo (importante).
 * O ícone precisa existir em `img/email/item-<icone>-<paleta>.png`.
 */
function aparencia({ tipo, categoria, prioridade }) {
    if (PRIORIDADE_ALTA.has(prioridade))
        return { paleta: 'correcao', rotulo: 'Importante', icone: 'sino' };
    if (tipo === 'resumo_diario')
        return { paleta: 'melhoria', rotulo: 'Resumo do dia', icone: 'grafico' };
    if (categoria === 'evento')
        return { paleta: 'melhoria', rotulo: 'Evento', icone: 'calendario' };
    if (categoria === 'academico')
        return { paleta: 'melhoria', rotulo: 'Acadêmico', icone: 'grafico' };
    if (categoria === 'sistema') return { paleta: 'novidade', rotulo: 'Sistema', icone: 'estrela' };
    return { paleta: 'novidade', rotulo: 'Aviso', icone: 'sino' };
}

function dataPorExtenso(data) {
    try {
        return new Intl.DateTimeFormat('pt-BR', {
            day: 'numeric',
            month: 'long',
            year: 'numeric',
            timeZone: 'America/Sao_Paulo',
        }).format(data);
    } catch {
        return '';
    }
}

/**
 * @param {{ titulo: string, mensagem: string, link: string, base: string,
 *           tipo?: string, categoria?: string, prioridade?: string, data?: Date }} n
 */
function htmlNotificacao({ titulo, mensagem, link, base, tipo, categoria, prioridade, data }) {
    const { paleta, rotulo, icone } = aparencia({ tipo, categoria, prioridade });
    const t = TIPOS[paleta];
    const b = escaparHtml(String(base || '').replace(/\/+$/, ''));
    const linkSeguro = escaparHtml(link || b || '/');
    const tituloSeguro = escaparHtml(titulo);
    const corpo = escaparHtml(mensagem).replace(/\r?\n/g, '<br>');
    const quando = escaparHtml(dataPorExtenso(data || new Date()));
    const previa = escaparHtml(String(mensagem ?? '').slice(0, 140));

    return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark">
<meta name="supported-color-schemes" content="dark">
<title>${tituloSeguro}</title>
<style>
    @media (max-width: 520px) {
        .nt-ondas { display: none !important; }
        .nt-marca { white-space: normal !important; letter-spacing: 2px !important; font-size: 13px !important; }
        .nt-titulo { font-size: 26px !important; line-height: 33px !important; }
        .nt-bloco { display: block !important; width: 100% !important; box-sizing: border-box; }
        .nt-some { display: none !important; }
    }
</style>
</head>
<body style="margin:0;padding:0;background:#05080c;">
<div style="margin:0;padding:32px 12px;background:#05080c;">
    <div style="display:none;max-height:0;overflow:hidden;">${previa}</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;margin:0 auto;">
        <tr><td>
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#0a121a;border:1px solid #173247;border-radius:14px;overflow:hidden;">
                <tr>
                    <td width="72" valign="middle" style="padding:20px 0 20px 26px;">${img(b, 'logo', 72, 'Sistema Escolar')}</td>
                    <td width="1" valign="middle" style="padding:0 0 0 22px;"><div style="width:1px;height:50px;background:#2a4a5c;"></div></td>
                    <td class="nt-marca" valign="middle" style="padding:0 16px 0 22px;font-family:${FONTE};font-size:15px;line-height:24px;font-weight:700;letter-spacing:4px;white-space:nowrap;">
                        <div style="color:#ffffff;">SISTEMA ESCOLAR</div>
                        <div style="color:${t.cor};">NOTIFICAÇÃO</div>
                    </td>
                    <td class="nt-ondas" width="250" align="right" valign="bottom" style="padding:0;line-height:0;font-size:0;">
                        <img src="${b}/img/email/ondas.png" width="250" height="112" alt="" style="display:block;border:0;width:250px;height:112px;">
                    </td>
                </tr>
            </table>
        </td></tr>

        <tr><td style="padding:34px 8px 0 8px;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                <tr>
                    <td valign="middle">${img(b, 'calendario-mint', 24)}</td>
                    <td valign="middle" style="padding-left:14px;font-family:${FONTE};font-size:18px;color:#c9d6e2;">${quando}</td>
                </tr>
            </table>
            <div class="nt-titulo" style="margin-top:10px;font-family:${FONTE};font-size:34px;line-height:42px;font-weight:800;letter-spacing:-0.5px;color:#ffffff;">${tituloSeguro}</div>
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-top:20px;">
                <tr><td style="padding:0 0 4px 0;">
                    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border:1px solid ${t.cor}88;background:${t.fundoChip};border-radius:999px;">
                        <tr>
                            <td valign="middle" style="padding:9px 10px 9px 16px;"><div style="width:10px;height:10px;border-radius:999px;background:${t.cor};"></div></td>
                            <td style="padding:9px 18px 9px 0;font-family:${FONTE};font-size:15px;font-weight:600;color:#eaf2f8;white-space:nowrap;">${rotulo}</td>
                        </tr>
                    </table>
                </td></tr>
            </table>
        </td></tr>

        <tr><td style="padding:22px 8px 0 8px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#0a121a;border:1px solid ${t.borda};border-radius:14px;">
                <tr>
                    <td width="52" valign="top" style="padding:22px 0 22px 22px;">${img(b, `item-${icone}-${paleta}`, 52)}</td>
                    <td width="2" valign="top" style="padding:22px 18px;">
                        <div style="width:2px;height:52px;background:${t.cor};border-radius:2px;"></div>
                    </td>
                    <td valign="middle" style="padding:20px 22px 20px 0;font-family:${FONTE};font-size:15px;line-height:23px;color:#c9d6e2;">${corpo}</td>
                </tr>
            </table>
        </td></tr>

        <tr><td align="center" style="padding:30px 8px 34px 8px;">
            <a href="${linkSeguro}" style="display:inline-block;background-color:#2fe5b5;background-image:linear-gradient(90deg,#2fe5b5 0%,#3fc4d8 45%,#6f7bff 100%);border-radius:999px;padding:17px 44px;text-decoration:none;">
                <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
                    <td valign="middle" style="font-family:${FONTE};font-size:18px;font-weight:700;color:#04110c;white-space:nowrap;">Abrir no sistema</td>
                    <td valign="middle" style="padding-left:12px;">${img(b, 'seta-direita-escuro', 20)}</td>
                </tr></table>
            </a>
        </td></tr>

        <tr><td style="border-top:1px solid #1a2733;padding:22px 8px 0 8px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                    <td class="nt-some" width="28" valign="middle" style="padding:0 18px 0 16px;">${img(b, 'email-cinza', 28)}</td>
                    <td class="nt-some" width="1" valign="middle"><div style="width:1px;height:40px;background:#2a3a4a;"></div></td>
                    <td class="nt-bloco" valign="middle" style="padding:0 18px 14px 18px;font-family:${FONTE};font-size:12px;line-height:19px;color:#8d9cad;">
                        Você recebe este e-mail porque as notificações por e-mail estão ativas no seu perfil.<br>
                        Este é um e-mail automático. Por favor, não responda.
                    </td>
                    <td class="nt-some" width="1" valign="middle"><div style="width:1px;height:40px;background:#2a3a4a;"></div></td>
                    <td width="40" valign="middle" style="padding:0 14px 14px 18px;">${img(b, 'logo', 40)}</td>
                    <td valign="middle" style="padding:0 8px 14px 0;font-family:${FONTE};font-size:12px;line-height:17px;color:#c9d6e2;white-space:nowrap;">Juntos por<br>uma escola melhor!</td>
                </tr>
            </table>
        </td></tr>
    </table>
</div>
</body>
</html>`;
}

module.exports = { htmlNotificacao };
