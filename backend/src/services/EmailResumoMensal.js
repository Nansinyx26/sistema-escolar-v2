/**
 * HTML do e-mail "Resumo mensal" (novidades, melhorias e correções do mês).
 *
 * Feito para cliente de e-mail: tabelas, estilo inline e imagens PNG (Gmail e
 * Outlook não exibem SVG). As imagens ficam em `img/email/` no frontend e são
 * geradas por `scripts/gerar-imagens-email.js` — os nomes usados aqui são o
 * contrato com aquele script.
 */

const TIPOS = {
    novidade: {
        titulo: 'Novidades',
        singular: 'novidade',
        plural: 'novidades',
        cor: '#2fe5b5',
        borda: '#17463d',
        fundoChip: '#0b2723',
        iconeChip: 'estrela-mint',
        iconeSecao: 'estrela-mint',
        seta: 'seta-direita-mint',
        iconePadrao: 'estrela',
    },
    melhoria: {
        titulo: 'Melhorias',
        singular: 'melhoria',
        plural: 'melhorias',
        cor: '#4a90ff',
        borda: '#1b3558',
        fundoChip: '#0e1f3a',
        iconeChip: 'seta-cima-azul',
        iconeSecao: 'tendencia-azul',
        seta: 'seta-direita-azul',
        iconePadrao: 'tendencia',
    },
    correcao: {
        titulo: 'Correções',
        singular: 'correção',
        plural: 'correções',
        cor: '#9d7bff',
        borda: '#2c2a5c',
        fundoChip: '#19183a',
        iconeChip: 'check-roxo',
        iconeSecao: 'chave-roxo',
        seta: 'seta-direita-roxo',
        iconePadrao: 'chave',
    },
};

/** Ícones que existem em `img/email/item-<icone>-<tipo>.png`. */
const ICONES_DE_ITEM = new Set([
    'estrela',
    'tendencia',
    'chave',
    'pdf',
    'robo',
    'raio',
    'celular',
    'sino',
    'grafico',
    'calendario',
]);

const FONTE = "'Outfit','Segoe UI',Roboto,Helvetica,Arial,sans-serif";

function escaparHtml(texto) {
    return String(texto ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function img(base, nome, tamanho, alt = '') {
    return `<img src="${base}/img/email/${nome}.png" width="${tamanho}" height="${tamanho}" alt="${escaparHtml(alt)}" style="display:block;border:0;outline:none;width:${tamanho}px;height:${tamanho}px;">`;
}

function chip(base, t, n) {
    return `<td class="rm-chip" style="padding:0 10px 10px 0;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border:1px solid ${t.cor}88;background:${t.fundoChip};border-radius:999px;">
            <tr>
                <td style="padding:9px 8px 9px 16px;">${img(base, t.iconeChip, 18)}</td>
                <td style="padding:9px 18px 9px 0;font-family:${FONTE};font-size:15px;font-weight:600;color:#eaf2f8;white-space:nowrap;">${n} ${n === 1 ? t.singular : t.plural}</td>
            </tr>
        </table>
    </td>`;
}

function card(base, t, tipo, item, link) {
    const icone = ICONES_DE_ITEM.has(item.icone) ? item.icone : t.iconePadrao;
    const detalhe = item.detalhe
        ? `<div style="margin-top:6px;font-family:${FONTE};font-size:14px;line-height:21px;color:#9fb0c1;">${escaparHtml(item.detalhe)}</div>`
        : '';
    return `<tr><td style="padding:0 0 12px 0;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#0a121a;border:1px solid ${t.borda};border-radius:14px;">
            <tr>
                <td width="52" valign="middle" style="padding:20px 0 20px 22px;">${img(base, `item-${icone}-${tipo}`, 52)}</td>
                <td width="2" valign="middle" style="padding:0 18px;">
                    <div style="width:2px;height:52px;background:${t.cor};border-radius:2px;"></div>
                </td>
                <td valign="middle" style="padding:18px 0;">
                    <div style="font-family:${FONTE};font-size:16px;line-height:22px;font-weight:700;color:#ffffff;">${escaparHtml(item.texto)}</div>
                    ${detalhe}
                </td>
                <td width="22" valign="middle" style="padding:0 20px 0 14px;">
                    <a href="${link}" style="text-decoration:none;">${img(base, t.seta, 22, 'Abrir')}</a>
                </td>
            </tr>
        </table>
    </td></tr>`;
}

function secao(base, tipo, itens, link) {
    const t = TIPOS[tipo];
    return `<tr><td style="padding:22px 0 14px 0;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
            <tr>
                <td width="24" valign="middle">${img(base, t.iconeSecao, 24)}</td>
                <td valign="middle" style="padding:0 18px 0 12px;font-family:${FONTE};font-size:18px;font-weight:800;letter-spacing:1px;text-transform:uppercase;color:${t.cor};white-space:nowrap;">${t.titulo}</td>
                <td valign="middle" width="100%"><div style="height:1px;line-height:1px;font-size:0;background:${t.cor};">&nbsp;</div></td>
            </tr>
        </table>
    </td></tr>
    ${itens.map((i) => card(base, t, tipo, i, link)).join('')}`;
}

/**
 * @param {{ mesNome: string, itens: Array<{tipo, texto, detalhe?, icone?}> }} resumo
 * @param {string} link   para onde o botão e as setas levam
 * @param {string} base   URL pública do frontend (onde está `img/email/`)
 */
function htmlResumoMensal(resumo, link, base) {
    const linkSeguro = escaparHtml(link);
    const baseLimpa = escaparHtml(String(base || '').replace(/\/+$/, ''));
    const porTipo = Object.keys(TIPOS)
        .map((tipo) => ({ tipo, itens: resumo.itens.filter((i) => i.tipo === tipo) }))
        .filter((g) => g.itens.length > 0);
    const previa = `O que mudou no Sistema Escolar em ${resumo.mesNome}.`;

    return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark">
<meta name="supported-color-schemes" content="dark">
<title>${escaparHtml(previa)}</title>
<style>
    @media (max-width: 520px) {
        .rm-ondas { display: none !important; }
        .rm-marca { white-space: normal !important; letter-spacing: 2px !important; font-size: 13px !important; }
        .rm-titulo { font-size: 32px !important; line-height: 40px !important; }
        .rm-bloco { display: block !important; width: 100% !important; box-sizing: border-box; }
        .rm-some { display: none !important; }
        .rm-chip { display: inline-block !important; }
        .rm-rodape td { text-align: left !important; }
    }
</style>
</head>
<body style="margin:0;padding:0;background:#05080c;">
<div style="margin:0;padding:32px 12px;background:#05080c;">
    <div style="display:none;max-height:0;overflow:hidden;">${escaparHtml(previa)}</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;margin:0 auto;">
        <tr><td>
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#0a121a;border:1px solid #173247;border-radius:14px;overflow:hidden;">
                <tr>
                    <td width="72" valign="middle" style="padding:20px 0 20px 26px;">${img(baseLimpa, 'logo', 72, 'Sistema Escolar')}</td>
                    <td width="1" valign="middle" style="padding:0 0 0 22px;"><div style="width:1px;height:50px;background:#2a4a5c;"></div></td>
                    <td class="rm-marca" valign="middle" style="padding:0 16px 0 22px;font-family:${FONTE};font-size:15px;line-height:24px;font-weight:700;letter-spacing:4px;white-space:nowrap;">
                        <div style="color:#ffffff;">SISTEMA ESCOLAR</div>
                        <div style="color:#2fe5b5;">RESUMO MENSAL</div>
                    </td>
                    <td class="rm-ondas" width="250" align="right" valign="bottom" style="padding:0;line-height:0;font-size:0;">
                        <img src="${baseLimpa}/img/email/ondas.png" width="250" height="112" alt="" style="display:block;border:0;width:250px;height:112px;">
                    </td>
                </tr>
            </table>
        </td></tr>

        <tr><td style="padding:34px 8px 0 8px;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                <tr>
                    <td valign="middle">${img(baseLimpa, 'calendario-mint', 24)}</td>
                    <td valign="middle" style="padding-left:14px;font-family:${FONTE};font-size:18px;color:#c9d6e2;">${escaparHtml(resumo.mesNome)}</td>
                </tr>
            </table>
            <div class="rm-titulo" style="margin-top:10px;font-family:${FONTE};font-size:42px;line-height:50px;font-weight:800;letter-spacing:-0.5px;color:#ffffff;">O que há de <span style="color:#2fe5b5;">novo</span></div>
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-top:20px;">
                <tr>${porTipo.map((g) => chip(baseLimpa, TIPOS[g.tipo], g.itens.length)).join('')}</tr>
            </table>
        </td></tr>

        <tr><td style="padding:6px 8px 0 8px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                ${porTipo.map((g) => secao(baseLimpa, g.tipo, g.itens, linkSeguro)).join('')}
            </table>
        </td></tr>

        <tr><td align="center" style="padding:26px 8px 34px 8px;">
            <a href="${linkSeguro}" style="display:inline-block;background-color:#2fe5b5;background-image:linear-gradient(90deg,#2fe5b5 0%,#3fc4d8 45%,#6f7bff 100%);border-radius:999px;padding:17px 44px;text-decoration:none;">
                <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
                    <td valign="middle" style="font-family:${FONTE};font-size:18px;font-weight:700;color:#04110c;white-space:nowrap;">Acessar o sistema</td>
                    <td valign="middle" style="padding-left:12px;">${img(baseLimpa, 'seta-direita-escuro', 20)}</td>
                </tr></table>
            </a>
        </td></tr>

        <tr><td style="border-top:1px solid #1a2733;padding:22px 8px 0 8px;">
            <table class="rm-rodape" role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                    <td class="rm-some" width="28" valign="middle" style="padding:0 18px 0 16px;">${img(baseLimpa, 'email-cinza', 28)}</td>
                    <td class="rm-some" width="1" valign="middle"><div style="width:1px;height:40px;background:#2a3a4a;"></div></td>
                    <td class="rm-bloco" valign="middle" style="padding:0 18px 14px 18px;font-family:${FONTE};font-size:12px;line-height:19px;color:#8d9cad;">
                        Você recebe este resumo uma vez por mês, no dia 1.<br>
                        Este é um e-mail automático. Por favor, não responda.
                    </td>
                    <td class="rm-some" width="1" valign="middle"><div style="width:1px;height:40px;background:#2a3a4a;"></div></td>
                    <td width="40" valign="middle" style="padding:0 14px 14px 18px;">${img(baseLimpa, 'logo', 40)}</td>
                    <td valign="middle" style="padding:0 8px 14px 0;font-family:${FONTE};font-size:12px;line-height:17px;color:#c9d6e2;white-space:nowrap;">Juntos por<br>uma escola melhor!</td>
                </tr>
            </table>
        </td></tr>
    </table>
</div>
</body>
</html>`;
}

// As peças visuais também servem ao e-mail de cada notificação
// (services/EmailNotificacao.js), para os dois terem a mesma identidade.
module.exports = { htmlResumoMensal, TIPOS, FONTE, escaparHtml, img };
