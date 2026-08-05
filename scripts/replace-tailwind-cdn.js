const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.join(__dirname, '../');

function walkDir(dir, callback) {
    fs.readdirSync(dir).forEach(f => {
        let dirPath = path.join(dir, f);
        let isDirectory = fs.statSync(dirPath).isDirectory();
        if (isDirectory) {
            if (f !== 'node_modules' && f !== '.git' && f !== 'backend' && f !== 'portal-responsavel') {
                walkDir(dirPath, callback);
            }
        } else {
            callback(dirPath);
        }
    });
}

function replaceTailwindInFile(filePath) {
    if (path.extname(filePath) !== '.html') return;

    let content = fs.readFileSync(filePath, 'utf8');
    if (!content.includes('cdn.tailwindcss.com')) return;

    // Calculate relative path depth
    let relative = path.relative(ROOT_DIR, filePath);
    let depth = relative.split(path.sep).length - 1;
    let cssPath = 'css/tailwind-built.css';
    if (depth > 0) {
        cssPath = '../'.repeat(depth) + cssPath;
    }

    console.log(`Processing: ${relative} (depth: ${depth}) -> css path: ${cssPath}`);

    // Regular expressions to match the various styles of Play CDN imports
    const cdnPatternFull = /<script\s+src="https:\/\/cdn\.tailwindcss\.com"><\/script>\s*<script>\s*if\s*\(window\.tailwind\)\s*\{\s*tailwind\.config\s*=\s*\{\s*corePlugins:\s*\{\s*preflight:\s*false\s*\}\s*\}\s*;\s*\}\s*<\/script>/gi;
    const cdnPatternFullSingleQuote = /<script\s+src='https:\/\/cdn\.tailwindcss\.com'><\/script>\s*<script>\s*if\s*\(window\.tailwind\)\s*\{\s*tailwind\.config\s*=\s*\{\s*corePlugins:\s*\{\s*preflight:\s*false\s*\}\s*\}\s*;\s*\}\s*<\/script>/gi;
    const cdnPatternSimple = /<script\s+src="https:\/\/cdn\.tailwindcss\.com"><\/script>/gi;
    const cdnPatternSimpleSingle = /<script\s+src='https:\/\/cdn\.tailwindcss\.com'><\/script>/gi;

    let original = content;
    let replaced = false;

    // Try full replacement first
    let newContent = content.replace(cdnPatternFull, `<!-- Offline Compiled Tailwind CSS -->\n    <link rel="stylesheet" href="${cssPath}">`);
    if (newContent !== content) {
        content = newContent;
        replaced = true;
    }

    newContent = content.replace(cdnPatternFullSingleQuote, `<!-- Offline Compiled Tailwind CSS -->\n    <link rel="stylesheet" href="${cssPath}">`);
    if (newContent !== content) {
        content = newContent;
        replaced = true;
    }

    // Try simple replacements for cases without config
    newContent = content.replace(cdnPatternSimple, `<!-- Offline Compiled Tailwind CSS -->\n    <link rel="stylesheet" href="${cssPath}">`);
    if (newContent !== content) {
        content = newContent;
        replaced = true;
    }

    newContent = content.replace(cdnPatternSimpleSingle, `<!-- Offline Compiled Tailwind CSS -->\n    <link rel="stylesheet" href="${cssPath}">`);
    if (newContent !== content) {
        content = newContent;
        replaced = true;
    }

    // Fallback regex replacement for dynamic spacing/comments
    if (!replaced) {
        let regexFallback = /<script[^>]*src=["']https:\/\/cdn\.tailwindcss\.com["'][^>]*>[\s\S]*?<\/script>(\s*<script>[\s\S]*?<\/script>)?/gi;
        newContent = content.replace(regexFallback, `<!-- Offline Compiled Tailwind CSS -->\n    <link rel="stylesheet" href="${cssPath}">`);
        if (newContent !== content) {
            content = newContent;
            replaced = true;
        }
    }

    if (replaced) {
        fs.writeFileSync(filePath, content, 'utf8');
        console.log(`✅ Success: ${relative}`);
    } else {
        console.warn(`⚠️ Warning: Could not perform standard replacement on ${relative}`);
    }
}

console.log('Starting Tailwind CDN Migration to Offline Compilation...');
walkDir(ROOT_DIR, replaceTailwindInFile);
console.log('Migration Completed!');
