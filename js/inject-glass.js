const fs = require('fs');
const path = require('path');
const ROOT = 'c:/Users/Usuario1/Downloads/sistema-escolar-v2-main/sistema-escolar-v2-main';

function rel(htmlFile, asset) {
    return path.relative(path.dirname(htmlFile), path.join(ROOT, asset)).replace(/\\/g, '/');
}

function walk(dir) {
    fs.readdirSync(dir).forEach(f => {
        const full = path.join(dir, f);
        if (fs.lstatSync(full).isDirectory()) {
            if (!['node_modules', '.git', 'backend'].includes(f)) walk(full);
        } else if (f.endsWith('.html')) {
            let c = fs.readFileSync(full, 'utf8');
            if (c.includes('neo-brutal.css')) { console.log('SKIP:', f); return; }
            const tag = '<link rel="stylesheet" href="' + rel(full, 'css/neo-brutal.css') + '">';
            if (c.includes('</head>')) {
                c = c.replace('</head>', '    ' + tag + '\n</head>');
                fs.writeFileSync(full, c, 'utf8');
                console.log('INJECTED:', f);
            }
        }
    });
}

walk(ROOT);
console.log('Done!');
