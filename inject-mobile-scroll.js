/**
 * Injeta css/mobile-scroll.css e js/scroll-lock.js em todas as páginas HTML.
 *
 * A folha PRECISA ser a última do <head>: sidebar.css, dashboard-premium.css,
 * tailwind-built.css e system-global.css carregam depois de
 * responsive-global.css e sobrescreviam as correções de rolagem.
 *
 * Idempotente — pode rodar várias vezes.
 * Uso: node inject-mobile-scroll.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
// portal-responsavel é um app Vite com raiz própria: um <link ../css/…>
// ficaria fora da raiz e não entraria no build. Ele é tratado à parte,
// copiando os arquivos para portal-responsavel/public/ (ver copyToPortal).
const SKIP = ['node_modules', '.git', 'dist', 'build', '%TEMP%', 'portal-responsavel'];

const CSS_VERSION = '1.0';
const JS_VERSION = '1.0';

function walkHtml(dir) {
    const results = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (SKIP.includes(entry.name)) continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) results.push(...walkHtml(full));
        else if (entry.name.endsWith('.html')) results.push(full);
    }
    return results;
}

const files = walkHtml(ROOT);
let updated = 0;
let skipped = 0;

for (const file of files) {
    let content = fs.readFileSync(file, 'utf-8');

    if (!content.includes('</head>')) {
        console.log('SEM <head>:', path.relative(ROOT, file));
        skipped++;
        continue;
    }

    const rel = path.relative(path.dirname(file), ROOT).replace(/\\/g, '/');
    const prefix = rel ? rel + '/' : '';

    const hasCss = content.includes('css/mobile-scroll.css');
    const hasJs = content.includes('js/scroll-lock.js');

    if (hasCss && hasJs) {
        skipped++;
        continue;
    }

    let block = '';
    if (!hasCss) {
        block +=
            `    <!-- Rolagem e performance mobile — deve ser o ÚLTIMO stylesheet -->\n` +
            `    <link rel="stylesheet" href="${prefix}css/mobile-scroll.css?v=${CSS_VERSION}">\n`;
    }
    if (!hasJs) {
        block += `    <script src="${prefix}js/scroll-lock.js?v=${JS_VERSION}"></script>\n`;
    }

    // Insere imediatamente antes de </head> para ficar depois de todo <link>.
    content = content.replace(/([ \t]*)<\/head>/i, block + '$1</head>');

    fs.writeFileSync(file, content, 'utf-8');
    console.log('OK:', path.relative(ROOT, file));
    updated++;
}

console.log(`\nConcluído: ${updated} atualizados, ${skipped} já estavam prontos.`);

/**
 * O portal do responsável (Vite) só serve arquivos de dentro da própria
 * raiz, então mantemos cópias em public/. O index.html dele já aponta
 * para /mobile-scroll.css e /scroll-lock.js.
 */
function copyToPortal() {
    const publicDir = path.join(ROOT, 'portal-responsavel', 'public');
    if (!fs.existsSync(publicDir)) {
        console.log('portal-responsavel/public não encontrado — cópia ignorada.');
        return;
    }
    const pairs = [
        ['css/mobile-scroll.css', 'mobile-scroll.css'],
        ['js/scroll-lock.js', 'scroll-lock.js']
    ];
    for (const [src, dest] of pairs) {
        fs.copyFileSync(path.join(ROOT, src), path.join(publicDir, dest));
        console.log('COPIADO -> portal-responsavel/public/' + dest);
    }
}

copyToPortal();
