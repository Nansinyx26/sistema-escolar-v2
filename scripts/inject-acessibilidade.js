/**
 * inject-acessibilidade.js — coloca os recursos de acessibilidade em todas as
 * páginas HTML de uma vez.
 *
 * POR QUE UM CODEMOD, E NÃO EDIÇÃO MANUAL
 * ---------------------------------------
 * São ~35 páginas. Acessibilidade que existe em algumas telas não cumpre a LBI:
 * a pessoa com deficiência visual não escolhe por qual página entra no sistema,
 * e "o alto contraste some quando eu clico em Turmas" é o mesmo que não ter
 * alto contraste. Editar à mão garante que a próxima página nasça sem — este
 * script é rodado de novo e conserta.
 *
 * É IDEMPOTENTE: rodar duas vezes não duplica nada.
 *
 * Uso: node scripts/inject-acessibilidade.js
 *
 * `offline.html` fica de fora porque precisa ser 100% autocontida — ela é
 * servida justamente quando não há rede para buscar CSS e JS externos. É a
 * mesma exclusão que os outros injetores do repositório já fazem.
 */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const PULAR_DIRETORIOS = ['node_modules', 'portal-responsavel', '.git', 'coverage', 'dist'];
const PULAR_ARQUIVOS = ['offline.html'];

const CSS = 'css/acessibilidade.css';
const JS = 'js/acessibilidade.js';

function listarHtml(dir) {
    const encontrados = [];
    for (const entrada of fs.readdirSync(dir, { withFileTypes: true })) {
        if (PULAR_DIRETORIOS.includes(entrada.name)) continue;
        const completo = path.join(dir, entrada.name);
        if (entrada.isDirectory()) encontrados.push(...listarHtml(completo));
        else if (entrada.name.endsWith('.html')) encontrados.push(completo);
    }
    return encontrados;
}

function prefixoAte(arquivo) {
    const relativo = path.relative(path.dirname(arquivo), ROOT).replace(/\\/g, '/');
    return relativo ? `${relativo}/` : '';
}

let alterados = 0;

for (const arquivo of listarHtml(ROOT)) {
    if (PULAR_ARQUIVOS.includes(path.basename(arquivo))) continue;

    let conteudo = fs.readFileSync(arquivo, 'utf-8');
    const original = conteudo;
    const prefixo = prefixoAte(arquivo);

    if (!conteudo.includes(CSS) && conteudo.includes('</head>')) {
        conteudo = conteudo.replace(
            '</head>',
            `    <!-- Acessibilidade (LBI/eMAG) — ver docs/CONFORMIDADE-LEGAL.md -->\n` +
                `    <link rel="stylesheet" href="${prefixo}${CSS}">\n</head>`
        );
    }

    if (!conteudo.includes(JS) && conteudo.includes('</body>')) {
        conteudo = conteudo.replace(
            '</body>',
            `    <script defer src="${prefixo}${JS}"></script>\n</body>`
        );
    }

    if (conteudo !== original) {
        fs.writeFileSync(arquivo, conteudo, 'utf-8');
        alterados += 1;
        console.log(`  atualizada: ${path.relative(ROOT, arquivo)}`);
    }
}

console.log(`\n${alterados} página(s) atualizada(s).`);
