/**
 * Batch inject PWA features (Splash Screen and Reactions) into all HTML files
 * Run: node inject-pwa-features.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const SKIP = ['node_modules', 'portal-responsavel', '.git', 'portal-responsavel/dist'];

function walkHtml(dir) {
    const results = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (SKIP.includes(entry.name)) continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            results.push(...walkHtml(full));
        } else if (entry.name.endsWith('.html')) {
            results.push(full);
        }
    }
    return results;
}

// offline.html precisa ser 100% autocontido (é servido justamente quando não
// há rede), portanto nenhum script/CSS externo pode ser injetado nela.
const SKIP_FILES = ['offline.html'];

const files = walkHtml(ROOT).filter((f) => !SKIP_FILES.includes(path.basename(f)));
let updated = 0;

for (const file of files) {
    let content = fs.readFileSync(file, 'utf-8');
    let hasChanges = false;

    // Calculate relative path prefix from file to ROOT
    const fileDir = path.dirname(file);
    const relToRoot = path.relative(fileDir, ROOT).replace(/\\/g, '/');
    const prefix = relToRoot ? relToRoot + '/' : '';

    // 1. Inject CSS links in <head>
    let cssInjections = '';
    if (!content.includes('splash-screen.css')) {
        cssInjections += `    <link rel="stylesheet" href="${prefix}css/splash-screen.css?v=1.0">\n`;
    }
    if (!content.includes('reactions.css')) {
        cssInjections += `    <link rel="stylesheet" href="${prefix}css/reactions.css?v=1.0">\n`;
    }
    
    if (cssInjections) {
        content = content.replace('</head>', cssInjections + '</head>');
        hasChanges = true;
    }

    // 2. Inject Splash Screen HTML block right after <body>
    if (!content.includes('id="splashScreen"')) {
        // Extract page title dynamically for premium personalized subtitle
        let subtitle = 'Portal Educacional';
        const titleMatch = content.match(/<title>([^<]+)<\/title>/i);
        if (titleMatch && titleMatch[1]) {
            // Clean up title (e.g. remove "Sistema Escolar" prefix/suffix)
            const cleanTitle = titleMatch[1]
                .replace(/—| - /g, '-')
                .split('-')[0]
                .trim();
            if (cleanTitle && !cleanTitle.toLowerCase().includes('sistema escolar')) {
                subtitle = cleanTitle;
            }
        }

        const splashHtml = `    <!-- Splash Screen (PWA) -->
    <div id="splashScreen">
        <div class="splash-logo-container">
            <div class="splash-logo">
                <i class="bi bi-mortarboard-fill"></i>
            </div>
            <div class="splash-logo-ring"></div>
        </div>
        <div class="splash-text">
            <h2 class="splash-title">Sistema Escolar</h2>
            <p class="splash-subtitle">${subtitle}</p>
        </div>
        <div class="splash-progress-container">
            <div class="splash-progress-track">
                <div class="splash-progress-bar"></div>
            </div>
            <div class="splash-progress-text">Inicializando sistema...</div>
        </div>
        <div class="splash-version">v3.0</div>
    </div>
    <script src="${prefix}js/splash-screen.js"></script>\n`;

        // Inject right after opening <body> tag
        content = content.replace(/(<body[^>]*>)/i, `$1\n${splashHtml}`);
        hasChanges = true;
    }

    // 3. Inject reactions.js right before </body>
    if (!content.includes('reactions.js')) {
        const reactionScript = `    <script defer src="${prefix}js/reactions.js"></script>\n`;
        content = content.replace('</body>', reactionScript + '</body>');
        hasChanges = true;
    }

    // 4. Inject push-notifications.js ("modo notificações no celular") before </body>.
    //    Pula as telas de login (usuário ainda não autenticado) e a própria home.
    const isLoginPage = /login/i.test(path.basename(file));
    if (!isLoginPage && !content.includes('push-notifications.js')) {
        const pushScript = `    <script defer src="${prefix}js/push-notifications.js"></script>\n`;
        content = content.replace('</body>', pushScript + '</body>');
        hasChanges = true;
    }

    // 5. Inject pwa-install.js before </body>
    if (!content.includes('pwa-install.js')) {
        const pwaInstallScript = `    <script defer src="${prefix}js/pwa-install.js"></script>\n`;
        content = content.replace('</body>', pwaInstallScript + '</body>');
        hasChanges = true;
    }

    // 6. Metadados do PWA. Sem <link rel="manifest"> na página em que o
    //    usuário está, o navegador não oferece "Instalar aplicativo".
    //    Caminhos absolutos: as páginas vivem em profundidades diferentes.
    let headMeta = '';
    if (!content.includes('rel="manifest"')) {
        headMeta += `    <link rel="manifest" href="/manifest.json">\n`;
    }
    if (!content.includes('apple-touch-icon')) {
        headMeta += `    <link rel="apple-touch-icon" href="/img/icons/apple-touch-icon-180.png">\n`;
    }
    if (!content.includes('name="theme-color"')) {
        headMeta += `    <meta name="theme-color" content="#09090b">\n`;
    }
    if (!content.includes('apple-mobile-web-app-capable')) {
        headMeta += `    <meta name="apple-mobile-web-app-capable" content="yes">\n`;
        headMeta += `    <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">\n`;
        headMeta += `    <meta name="apple-mobile-web-app-title" content="Escola">\n`;
    }
    if (!content.includes('name="mobile-web-app-capable"')) {
        headMeta += `    <meta name="mobile-web-app-capable" content="yes">\n`;
    }
    if (headMeta) {
        content = content.replace('</head>', headMeta + '</head>');
        hasChanges = true;
    }

    // 7. system-global.css SEMPRE por último no <head>: é a camada que
    //    padroniza selects, ícones, foco e acessibilidade em todo o sistema.
    if (!content.includes('system-global.css')) {
        content = content.replace(
            '</head>',
            `    <link rel="stylesheet" href="${prefix}css/system-global.css?v=1.0">\n</head>`
        );
        hasChanges = true;
    }

    // 8. settings-drawer.js (painel ⚙ de Configurações) em todas as páginas,
    //    exceto telas públicas de login/cadastro, onde não há sessão.
    const isPublicPage = /login|cadastro|reset-password|primeiro-acesso|politica-privacidade|offline/i
        .test(path.basename(file));
    if (!isPublicPage && !content.includes('settings-drawer.js')) {
        content = content.replace(
            '</body>',
            `    <script defer src="${prefix}js/settings-drawer.js"></script>\n</body>`
        );
        hasChanges = true;
    }

    if (hasChanges) {
        fs.writeFileSync(file, content, 'utf-8');
        console.log('INTEGRATED:', path.relative(ROOT, file));
        updated++;
    } else {
        console.log('ALREADY INTEGRATED:', path.relative(ROOT, file));
    }
}

console.log(`\nDone! PWA features successfully integrated into ${updated} files. Total files processed: ${files.length}.`);
