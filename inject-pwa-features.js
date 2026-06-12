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

const files = walkHtml(ROOT);
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

    if (hasChanges) {
        fs.writeFileSync(file, content, 'utf-8');
        console.log('INTEGRATED:', path.relative(ROOT, file));
        updated++;
    } else {
        console.log('ALREADY INTEGRATED:', path.relative(ROOT, file));
    }
}

console.log(`\nDone! PWA features successfully integrated into ${updated} files. Total files processed: ${files.length}.`);
