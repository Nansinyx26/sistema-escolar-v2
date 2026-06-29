/**
 * Batch inject responsive-global.css into all HTML files
 * Run: node inject-responsive.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const SKIP = ['node_modules', 'portal-responsavel', '.git'];

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

    if (content.includes('responsive-global.css')) {
        console.log('SKIP (already has):', path.relative(ROOT, file));
        continue;
    }

    // Calculate relative path from file to ROOT/css/
    const fileDir = path.dirname(file);
    const relToRoot = path.relative(fileDir, ROOT).replace(/\\/g, '/');
    const cssPrefix = relToRoot ? relToRoot + '/' : '';

    // Inject before </head>
    const link = `    <link rel="stylesheet" href="${cssPrefix}css/responsive-global.css?v=1.0">\n`;
    content = content.replace('</head>', link + '</head>');

    fs.writeFileSync(file, content, 'utf-8');
    console.log('UPDATED:', path.relative(ROOT, file));
    updated++;
}

console.log(`\nDone! Updated ${updated} files, skipped ${files.length - updated}.`);
