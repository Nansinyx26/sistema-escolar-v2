/**
 * strip-light-theme.js
 *
 * O sistema é dark-only (js/theme.js força data-theme="dark"). Todo bloco CSS
 * dirigido a [data-theme="light"] é código morto. Este script remove esses
 * blocos com segurança:
 *
 *  - Em uma regra com vários seletores separados por vírgula, remove apenas os
 *    seletores de tema claro e mantém os demais.
 *  - Se sobrar nenhum seletor, remove a regra inteira.
 *  - Percorre recursivamente at-rules (@media, @supports…) e remove o at-rule
 *    caso ele fique vazio.
 *  - Também remove @media (prefers-color-scheme: light).
 *
 * Uso: node scripts/strip-light-theme.js [--dry]
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.dirname(__dirname);
const DRY = process.argv.includes('--dry');

// Cobre as duas formas usadas no projeto: [data-theme="light"] e .light-theme.
const LIGHT_SELECTOR = /\[data-theme\s*=\s*['"]?light['"]?\]|\.light-theme\b/i;
const LIGHT_MEDIA = /prefers-color-scheme\s*:\s*light/i;

const TARGETS = [
    'css/chatbot-ia.css',
    'css/grade-horaria.css',
    'css/main.css',
    'css/reactions.css',
    'css/responsive-global.css',
    'css/selecionar.css',
    'css/splash-screen.css',
    'css/watermark.css',
    'css/turma.css',
    'html/primeiro-acesso.html',
    'html/pages/primeiro-acesso.html'
];

/** Divide um bloco CSS em nós (regras, at-rules, comentários e texto solto). */
function parseNodes(css) {
    const nodes = [];
    let i = 0;
    let buffer = '';

    while (i < css.length) {
        const ch = css[i];

        // Comentários são preservados como estão.
        if (ch === '/' && css[i + 1] === '*') {
            const end = css.indexOf('*/', i + 2);
            const stop = end === -1 ? css.length : end + 2;
            buffer += css.slice(i, stop);
            i = stop;
            continue;
        }

        if (ch === ';' && buffer.trim().startsWith('@')) {
            // At-rule sem bloco (@import, @charset).
            nodes.push({ type: 'raw', text: buffer + ';' });
            buffer = '';
            i++;
            continue;
        }

        if (ch === '{') {
            let depth = 1;
            let j = i + 1;
            while (j < css.length && depth > 0) {
                if (css[j] === '/' && css[j + 1] === '*') {
                    const end = css.indexOf('*/', j + 2);
                    j = end === -1 ? css.length : end + 2;
                    continue;
                }
                if (css[j] === '{') depth++;
                else if (css[j] === '}') depth--;
                j++;
            }
            nodes.push({
                type: 'block',
                prelude: buffer,
                body: css.slice(i + 1, j - 1)
            });
            buffer = '';
            i = j;
            continue;
        }

        buffer += ch;
        i++;
    }

    // Preserva também o espaço em branco final: descartá-lo colapsava as
    // chaves de fechamento de at-rules aninhados (`}}`).
    if (buffer) nodes.push({ type: 'raw', text: buffer });
    return nodes;
}

function isAtRule(prelude) {
    return prelude.trim().startsWith('@');
}

/** At-rules que contêm outras regras (e não declarações). */
function isNestedAtRule(prelude) {
    return /^\s*@(media|supports|layer|container|scope)\b/i.test(prelude);
}

function stripNodes(css, stats) {
    const nodes = parseNodes(css);
    const out = [];

    for (const node of nodes) {
        if (node.type === 'raw') {
            out.push(node.text);
            continue;
        }

        const prelude = node.prelude;
        // Comentários que precedem a regra fazem parte do prelúdio capturado;
        // eles são preservados na saída, mas não podem atrapalhar a detecção.
        const comments = (prelude.match(/\/\*[\s\S]*?\*\//g) || []).join('\n');
        const cleanPrelude = prelude.replace(/\/\*[\s\S]*?\*\//g, '');

        // Espaço em branco anterior à regra: precisa sobreviver à remoção,
        // senão o bloco seguinte cola no anterior (`}/* comentário */`).
        const lead = cleanPrelude.match(/^\s*/)[0];

        if (isAtRule(cleanPrelude)) {
            if (LIGHT_MEDIA.test(cleanPrelude)) {
                out.push(lead + (comments ? comments + '\n' : ''));
                stats.removedBlocks++;
                continue;
            }
            if (isNestedAtRule(cleanPrelude)) {
                const inner = stripNodes(node.body, stats);
                // At-rule que ficou sem nenhuma regra é descartado.
                if (!inner.replace(/\/\*[\s\S]*?\*\//g, '').trim()) {
                    out.push(lead + (comments ? comments + '\n' : ''));
                    stats.removedBlocks++;
                    continue;
                }
                out.push(prelude + '{' + inner + '}');
                continue;
            }
            out.push(prelude + '{' + node.body + '}');
            continue;
        }

        // Regra comum: filtra os seletores de tema claro.
        const leading = lead;
        const selectors = cleanPrelude.trim().split(',');
        const kept = selectors
            // ":not([data-theme='light'])" é uma guarda de tema escuro, não uma
            // regra de tema claro: basta remover a negação, agora redundante.
            .map((sel) => {
                const simplified = sel.replace(/:not\(\s*\[data-theme\s*=\s*['"]?light['"]?\]\s*\)/gi, '');
                if (simplified !== sel) stats.trimmedSelectors++;
                return simplified.trim() || sel.trim();
            })
            .filter((sel) => !LIGHT_SELECTOR.test(sel));

        if (kept.length === 0) {
            // Comentários de seção continuam válidos mesmo sem a regra.
            out.push(lead + (comments ? comments + '\n' : ''));
            stats.removedBlocks++;
            continue;
        }

        // Regra intacta: reemite o prelúdio original para não reformatar o
        // arquivo (listas de seletores multilinha continuam multilinha).
        const unchanged = kept.length === selectors.length &&
            kept.every((sel, idx) => sel === selectors[idx].trim());
        if (unchanged) {
            out.push(prelude + '{' + node.body + '}');
            continue;
        }

        stats.trimmedSelectors += selectors.length - kept.length;
        out.push(
            (comments ? '\n' + comments : '') + leading +
            kept.join(',\n') + ' {' + node.body + '}'
        );
    }

    return out.join('');
}

let totalBlocks = 0;
let totalSelectors = 0;

for (const rel of TARGETS) {
    const file = path.join(ROOT, rel);
    if (!fs.existsSync(file)) {
        console.log('SKIP (inexistente):', rel);
        continue;
    }

    const original = fs.readFileSync(file, 'utf-8');
    if (!LIGHT_SELECTOR.test(original) && !LIGHT_MEDIA.test(original)) {
        console.log('OK (nada a remover):', rel);
        continue;
    }

    const stats = { removedBlocks: 0, trimmedSelectors: 0 };
    let result;

    if (rel.endsWith('.html')) {
        // Em HTML, só o conteúdo das tags <style> é CSS.
        result = original.replace(
            /(<style\b[^>]*>)([\s\S]*?)(<\/style>)/gi,
            (m, open, body, close) => open + stripNodes(body, stats).replace(/\n{3,}/g, '\n\n') + close
        );
    } else {
        result = stripNodes(original, stats);
        // Compacta as linhas em branco deixadas pelas remoções.
        result = result.replace(/\n{3,}/g, '\n\n');
    }

    totalBlocks += stats.removedBlocks;
    totalSelectors += stats.trimmedSelectors;

    if (!DRY) fs.writeFileSync(file, result, 'utf-8');

    console.log(
        `${DRY ? '[dry] ' : ''}${rel}: ${stats.removedBlocks} bloco(s) removido(s), ` +
        `${stats.trimmedSelectors} seletor(es) podado(s)`
    );
}

console.log(`\nTotal: ${totalBlocks} bloco(s) e ${totalSelectors} seletor(es) de tema claro removidos.`);
