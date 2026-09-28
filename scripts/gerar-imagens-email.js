/**
 * Gera os PNGs do e-mail do resumo mensal em `img/email/`.
 *
 * Gmail e Outlook não exibem SVG em e-mail, então os ícones são desenhados
 * aqui em SVG e fotografados em PNG (2x, fundo transparente). Rode de novo ao
 * adicionar um ícone: `node scripts/gerar-imagens-email.js`.
 *
 * Os nomes gerados são o contrato com backend/src/services/EmailService.js.
 */
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('@playwright/test');

const SAIDA = path.join(__dirname, '..', 'img', 'email');

const COR = {
    mint: '#2fe5b5',
    azul: '#4a90ff',
    roxo: '#9d7bff',
    cinza: '#a9b8c6',
};

// Fundo do círculo de cada card, por tipo.
const TIPOS = {
    novidade: { cor: COR.mint, fundo: '#0f3a33' },
    melhoria: { cor: COR.azul, fundo: '#12294a' },
    correcao: { cor: COR.roxo, fundo: '#241f4d' },
};

// Glifos em viewBox 24. `C` vira a cor; `F` o fundo (para recortes).
const GLIFOS = {
    estrela:
        '<path d="M12 1C12.8 7 17 11.2 23 12 17 12.8 12.8 17 12 23 11.2 17 7 12.8 1 12 7 11.2 11.2 7 12 1Z" fill="C" stroke="none"/>',
    'seta-cima': '<path d="M12 20V5M5.5 11.5 12 5l6.5 6.5"/>',
    check: '<circle cx="12" cy="12" r="10.5" fill="C" stroke="none"/><path d="M7.5 12.3l3 3 6-6.3" stroke="#0b0f1a" stroke-width="2.4"/>',
    tendencia: '<path d="M2.5 17.5l6.5-6.5 4 4 8.5-8.5"/><path d="M15 6.5h6.5V13"/>',
    chave: '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94z" fill="C"/>',
    pdf: '<path d="M14 2H6.5A2.5 2.5 0 0 0 4 4.5v15A2.5 2.5 0 0 0 6.5 22h11a2.5 2.5 0 0 0 2.5-2.5V8z"/><path d="M14 2v6h6"/><rect x="1.5" y="11" width="15" height="7.5" rx="1.6" fill="F" stroke="C" stroke-width="1.4"/><text x="9" y="16.9" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-weight="800" font-size="5.6" fill="C" stroke="none">PDF</text>',
    robo: '<rect x="4" y="8" width="16" height="12" rx="3.5"/><path d="M12 8V4.5"/><circle cx="12" cy="3.3" r="1.3" fill="C"/><circle cx="9" cy="13.5" r="1.5" fill="C" stroke="none"/><circle cx="15" cy="13.5" r="1.5" fill="C" stroke="none"/><path d="M9.5 17h5M1.5 12.5v3.5M22.5 12.5v3.5"/>',
    raio: '<path d="M13.5 1.5 3.5 14h7.5l-1 8.5 10.5-13h-7.5z" fill="C"/>',
    celular:
        '<rect x="6" y="1.5" width="12" height="21" rx="2.8"/><rect x="8.5" y="4.5" width="7" height="12" rx="1" fill="C" stroke="none" opacity=".35"/><path d="M11 19.3h2"/>',
    sino: '<path d="M6 9a6 6 0 0 1 12 0c0 7 3 8.5 3 8.5H3S6 16 6 9"/><path d="M10.2 21a2 2 0 0 0 3.6 0"/>',
    grafico: '<path d="M3 3v18h18"/><path d="M8 17v-5M13 17V8M18 17v-7"/>',
    calendario:
        '<rect x="3" y="4.5" width="18" height="17" rx="2.8"/><path d="M16 2.5v4M8 2.5v4M3 10h18"/><g fill="C" stroke="none"><circle cx="8" cy="14" r="1"/><circle cx="12" cy="14" r="1"/><circle cx="16" cy="14" r="1"/><circle cx="8" cy="17.8" r="1"/><circle cx="12" cy="17.8" r="1"/></g>',
    email: '<rect x="2" y="4.5" width="20" height="15" rx="2.8"/><path d="m2.5 6.5 9.5 7 9.5-7"/>',
    'seta-direita': '<path d="M4 12h15.5M13.5 6l6 6-6 6"/>',
};

// Ícones que o changelog pode pedir em cada item (`icone`).
const ICONES_DE_ITEM = [
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
];

function svgGlifo(nome, cor, { tamanho = 24, fundo = 'none', circulo = null } = {}) {
    const corpo = GLIFOS[nome].replace(/="C"/g, `="${cor}"`).replace(/="F"/g, `="${fundo}"`);
    const glifo = `<g fill="none" stroke="${cor}" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${corpo}</g>`;
    if (!circulo) {
        return `<svg xmlns="http://www.w3.org/2000/svg" width="${tamanho}" height="${tamanho}" viewBox="0 0 24 24">${glifo}</svg>`;
    }
    // Ícone de card: círculo tingido com o glifo ao centro (glifo a 58%).
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${tamanho}" height="${tamanho}" viewBox="0 0 48 48">
        <circle cx="24" cy="24" r="23.5" fill="${circulo}"/>
        <circle cx="24" cy="24" r="23" fill="none" stroke="${cor}" stroke-opacity=".12"/>
        <g transform="translate(10 10) scale(1.1667)">${glifo}</g>
    </svg>`;
}

const LOGO = `<svg xmlns="http://www.w3.org/2000/svg" width="72" height="72" viewBox="0 0 72 72">
    <defs>
        <linearGradient id="o1" x1="0" x2="1"><stop offset="0" stop-color="${COR.mint}"/><stop offset="1" stop-color="#22b8e0"/></linearGradient>
        <linearGradient id="o2" x1="0" x2="1"><stop offset="0" stop-color="#22c6d8"/><stop offset="1" stop-color="${COR.azul}"/></linearGradient>
        <linearGradient id="o3" x1="0" x2="1"><stop offset="0" stop-color="${COR.azul}"/><stop offset="1" stop-color="${COR.roxo}"/></linearGradient>
    </defs>
    <circle cx="36" cy="36" r="35" fill="#04070a" stroke="#1d2b36" stroke-width="1.5"/>
    <path d="M35 21.5c-5.5-3.2-11.5-3.8-17-2.2v18.2c5.5-1.6 11.5-1 17 2.2z" fill="#fff"/>
    <path d="M37 21.5c5.5-3.2 11.5-3.8 17-2.2v18.2c-5.5-1.6-11.5-1-17 2.2z" fill="#fff"/>
    <g fill="none" stroke-width="3" stroke-linecap="round">
        <path d="M15 43.5c5-3 9 3 14 0s9 3 14 0 9 3 14 0" stroke="url(#o1)"/>
        <path d="M15 49.5c5-3 9 3 14 0s9 3 14 0 9 3 14 0" stroke="url(#o2)"/>
        <path d="M18 55.5c4.5-2.6 8.2 2.6 12.7 0s8.2 2.6 12.7 0 8.2 2.6 12.6 0" stroke="url(#o3)"/>
    </g>
</svg>`;

// Ondas do lado direito do banner. Somem para a esquerda (máscara).
const ONDAS = `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="134" viewBox="0 0 300 134">
    <defs>
        <linearGradient id="a" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="#0c6f6a"/><stop offset=".6" stop-color="#1fb7a8"/><stop offset="1" stop-color="#2fe5b5"/></linearGradient>
        <linearGradient id="b" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="#0d3d7a"/><stop offset=".7" stop-color="#2a6fe0"/><stop offset="1" stop-color="#4a90ff"/></linearGradient>
        <linearGradient id="c" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="#2a1f7a"/><stop offset="1" stop-color="#7a5cf0"/></linearGradient>
        <linearGradient id="m" x1="0" x2="1"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".35" stop-color="#fff" stop-opacity=".9"/><stop offset="1" stop-color="#fff"/></linearGradient>
        <mask id="k"><rect width="300" height="134" fill="url(#m)"/></mask>
    </defs>
    <g mask="url(#k)" fill="none" stroke-linecap="round">
        <path d="M-10 150C70 140 110 70 170 58S250 30 320 -20" stroke="url(#a)" stroke-width="30" opacity=".9"/>
        <path d="M30 160C110 150 150 92 205 80S270 52 330 10" stroke="url(#b)" stroke-width="26" opacity=".95"/>
        <path d="M100 170C170 160 200 116 245 104S290 80 340 50" stroke="url(#c)" stroke-width="24"/>
        <path d="M-10 128C60 118 105 50 160 38S250 8 320 -40" stroke="#6ff5d2" stroke-opacity=".45" stroke-width="1.4"/>
        <path d="M60 170C130 160 170 108 220 96S285 66 330 36" stroke="#8fb8ff" stroke-opacity=".35" stroke-width="1.2"/>
    </g>
</svg>`;

async function fotografar(pagina, svg, arquivo) {
    await pagina.setContent(
        `<html><body style="margin:0;background:transparent">${svg}</body></html>`
    );
    const el = await pagina.$('svg');
    await el.screenshot({ path: path.join(SAIDA, arquivo), omitBackground: true });
}

async function main() {
    fs.mkdirSync(SAIDA, { recursive: true });
    const navegador = await chromium.launch(
        process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}
    );
    const pagina = await navegador.newPage({ deviceScaleFactor: 2 });

    await fotografar(pagina, LOGO, 'logo.png');
    await fotografar(pagina, ONDAS, 'ondas.png');

    // Ícones soltos (chips, seções, setas, cabeçalho e rodapé), 24px.
    const soltos = [
        ['estrela', 'mint'],
        ['seta-cima', 'azul'],
        ['check', 'roxo'],
        ['tendencia', 'azul'],
        ['chave', 'roxo'],
        ['calendario', 'mint'],
        ['email', 'cinza'],
        ['seta-direita', 'mint'],
        ['seta-direita', 'azul'],
        ['seta-direita', 'roxo'],
        ['seta-direita', 'escuro'],
    ];
    for (const [nome, cor] of soltos) {
        const hex = cor === 'escuro' ? '#04110c' : COR[cor];
        await fotografar(pagina, svgGlifo(nome, hex), `${nome}-${cor}.png`);
    }

    // Ícones dos cards: um por ícone × tipo, 48px com círculo.
    for (const icone of ICONES_DE_ITEM) {
        for (const [tipo, { cor, fundo }] of Object.entries(TIPOS)) {
            await fotografar(
                pagina,
                svgGlifo(icone, cor, { tamanho: 48, fundo, circulo: fundo }),
                `item-${icone}-${tipo}.png`
            );
        }
    }

    await navegador.close();
    console.log(`Imagens do e-mail geradas em ${path.relative(process.cwd(), SAIDA)}`);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
