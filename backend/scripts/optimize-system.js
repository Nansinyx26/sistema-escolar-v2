const fs = require('fs');
const path = require('path');

const targetDir = 'c:/Users/Usuario1/Downloads/sistema-escolar-v2-main/sistema-escolar-v2-main';

const optimizeFiles = (dir) => {
    fs.readdirSync(dir).forEach(file => {
        let fullPath = path.join(dir, file);
        if (fs.lstatSync(fullPath).isDirectory()) {
            if (file !== 'node_modules' && file !== '.git' && file !== 'backend') {
                optimizeFiles(fullPath);
            }
        } else if (fullPath.endsWith('.html')) {
            let content = fs.readFileSync(fullPath, 'utf8');
            let newContent = content;

            // Adding defer to scripts
            newContent = newContent.replace(/<script src=/g, '<script defer src=');
            // Clean up if defer was already there
            newContent = newContent.replace(/<script defer defer/g, '<script defer');

            // Responsive meta tags
            if (!newContent.includes('viewport-fit=cover')) {
                newContent = newContent.replace(
                    /<meta name="viewport" content="width=device-width, initial-scale=1.0">/, 
                    '<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">'
                );
            }

            if (content !== newContent) {
                fs.writeFileSync(fullPath, newContent, 'utf8');
                console.log('Optimized HTML:', fullPath);
            }
        } else if (fullPath.endsWith('.css')) {
            let content = fs.readFileSync(fullPath, 'utf8');
            let newContent = content;

            // Hardware acceleration
            if (!newContent.includes('will-change: transform')) {
                newContent = newContent.replace(
                    /\.transition \{/g,
                    '.transition {\n    will-change: transform, opacity;\n    transform: translateZ(0);'
                );
                newContent = newContent.replace(
                    /\.transition-fast \{/g,
                    '.transition-fast {\n    will-change: transform, opacity;\n    transform: translateZ(0);'
                );
                newContent = newContent.replace(
                    /\.transition-slow \{/g,
                    '.transition-slow {\n    will-change: transform, opacity;\n    transform: translateZ(0);'
                );
            }

            if (fullPath.endsWith('base.css') && !newContent.includes('.grid-responsive')) {
                newContent += `

/* === PERFORMANCE & RESPONSIVE UTILS (Auto Optimized) === */
* {
    -webkit-tap-highlight-color: transparent;
}
img {
    content-visibility: auto;
}
.grid-responsive {
    display: grid;
    grid-template-columns: 1fr;
    gap: var(--spacing-md);
}
@media (min-width: 640px) {
    .grid-responsive {
        grid-template-columns: repeat(2, 1fr);
    }
}
@media (min-width: 1024px) {
    .grid-responsive {
        grid-template-columns: repeat(3, 1fr);
    }
}
@media (max-width: 768px) {
    .login-container, .dashboard-container {
        padding: var(--spacing-sm);
    }
}
`;
            }

            if (content !== newContent) {
                fs.writeFileSync(fullPath, newContent, 'utf8');
                console.log('Optimized CSS:', fullPath);
            }
        }
    });
};

optimizeFiles(targetDir);
console.log('System optimization done!');
