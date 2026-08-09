#!/usr/bin/env node
/**
 * inject-motion.js — injeta o sistema de motion em todas as páginas HTML.
 *
 *   node scripts/inject-motion.js --dry-run   # mostra o que mudaria
 *   node scripts/inject-motion.js             # aplica
 *
 * O que faz em cada página:
 *   1. <link> para css/motion.css no <head>, depois das folhas existentes
 *      (para os tokens dele vencerem no cascade sem !important)
 *   2. <script defer> para js/motion.js antes de </body>
 *   3. decoding="async" em toda <img> que não tem
 *   4. loading="lazy" nas imagens abaixo da dobra
 *
 * Sobre o item 4: não dá para saber a dobra analisando HTML estático, então a
 * heurística é posição no documento — as duas primeiras imagens são tratadas
 * como acima da dobra (loading="eager" + fetchpriority="high", protegendo o
 * LCP) e as demais viram lazy. js/motion.js refina isso em runtime medindo a
 * posição real, mas só age em imagens que ainda não têm o atributo — então o
 * que está escrito aqui no HTML sempre vence.
 *
 * Idempotente: rodar de novo não duplica tag nem atributo.
 */

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const DRY_RUN = process.argv.includes('--dry-run');

const IGNORED_DIRS = new Set([
    'node_modules',
    '.git',
    'dist',
    'build',
    'coverage',
    'favicon',
    '%TEMP%',
    'playwright-report',
    'test-results',
    // O portal do responsável é um app Vite: o index.html dele é template de
    // build e caminho relativo para ../js/ não sobrevive ao bundle. Lá o motion
    // entra por import em src/main.tsx.
    'portal-responsavel',
]);

const CSS_MARKER = 'css/motion.css';

/**
 * Scripts globais injetados em toda página, na ordem em que devem carregar.
 * observability.js vem primeiro para já estar escutando `error` quando o
 * restante do JS da página começar a rodar.
 */
const SCRIPTS = ['js/observability.js', 'js/motion.js'];

/** Percorre o projeto coletando .html, pulando diretórios de build. */
function findHtmlFiles(dir, found = []) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            if (IGNORED_DIRS.has(entry.name)) continue;
            findHtmlFiles(full, found);
        } else if (entry.isFile() && entry.name.endsWith('.html')) {
            found.push(full);
        }
    }
    return found;
}

/** Caminho relativo de uma página até um recurso na raiz, sempre com "/". */
function relativeTo(htmlFile, asset) {
    const rel = path.relative(path.dirname(htmlFile), path.join(ROOT, asset));
    const normalized = rel.split(path.sep).join('/');
    return normalized.startsWith('.') ? normalized : `./${normalized}`;
}

/** Insere o <link> do motion.css como último stylesheet do <head>. */
function injectCss(html, href) {
    if (html.includes(CSS_MARKER)) return { html, changed: false };

    const tag = `    <link rel="stylesheet" href="${href}">\n`;

    // Preferência: logo após o último <link rel="stylesheet"> existente, para
    // os tokens de motion.css vencerem no cascade sem precisar de !important.
    const linkPattern = /<link[^>]+rel=["']stylesheet["'][^>]*>/gi;
    const matches = [...html.matchAll(linkPattern)];
    const last = matches.length > 0 ? matches[matches.length - 1] : null;

    if (last) {
        const at = last.index + last[0].length;
        return {
            html: `${html.slice(0, at)}\n${tag.trimEnd()}${html.slice(at)}`,
            changed: true,
        };
    }

    // Sem stylesheet nenhum: antes do </head>.
    if (/<\/head>/i.test(html)) {
        return { html: html.replace(/<\/head>/i, `${tag}</head>`), changed: true };
    }

    return { html, changed: false };
}

/** Insere um <script defer> antes do </body>, se ainda não estiver lá. */
function injectJs(html, src, marker) {
    if (html.includes(marker)) return { html, changed: false };

    const tag = `    <script defer src="${src}"></script>\n`;

    if (/<\/body>/i.test(html)) {
        return { html: html.replace(/<\/body>/i, `${tag}</body>`), changed: true };
    }
    if (/<\/html>/i.test(html)) {
        return { html: html.replace(/<\/html>/i, `${tag}</html>`), changed: true };
    }
    return { html: `${html}\n${tag}`, changed: true };
}

/**
 * Fragmento de HTML (sem <head> e sem <body>) é um pedaço incluído por outra
 * página — já herda o motion de quem o inclui. Injetar <link>/<script> ali
 * duplicaria o sistema e colocaria tag fora de lugar.
 */
function isFragment(html) {
    return !/<head[\s>]/i.test(html) && !/<body[\s>]/i.test(html);
}

/**
 * Garante a ordem de SCRIPTS no documento.
 *
 * Importa porque as tags são `defer`: elas executam na ordem em que aparecem.
 * observability.js precisa vir antes de motion.js para já estar escutando o
 * evento `error` quando o motion começar a rodar — motion.js toca todas as
 * páginas, então um defeito nele é exatamente o que não pode passar batido.
 *
 * Páginas que já tinham motion.js antes desta mudança ficaram com a ordem
 * invertida; esta função conserta e é idempotente.
 */
function normalizeScriptOrder(html) {
    const tagOf = (script) => {
        const re = new RegExp(
            `[ \\t]*<script\\b[^>]*src=["'][^"']*${script.replace(
                /[.*+?^${}()|[\]\\]/g,
                '\\$&'
            )}["'][^>]*></script>\\n?`,
            'i'
        );
        const match = html.match(re);
        return match ? { tag: match[0], index: match.index, re } : null;
    };

    const first = tagOf(SCRIPTS[0]);
    const second = tagOf(SCRIPTS[1]);

    if (!first || !second || first.index < second.index) {
        return { html, changed: false };
    }

    // Remove a tag adiantada e reinsere antes da que deve vir depois.
    const without = html.replace(first.re, '');
    const target = without.match(second.re);
    if (!target) return { html, changed: false };

    return {
        html: without.replace(second.re, first.tag + target[0]),
        changed: true,
    };
}

/**
 * decoding="async" em todas as imagens; loading conforme a posição.
 * Retorna também quantas imagens foram tocadas, para o relatório.
 */
function applyImageAttrs(html) {
    let index = 0;
    let touched = 0;

    const out = html.replace(/<img\b([^>]*?)(\/?)>/gi, (full, attrs, selfClose) => {
        const current = index++;
        let next = attrs;
        let changed = false;

        if (!/\bdecoding\s*=/i.test(next)) {
            next += ' decoding="async"';
            changed = true;
        }

        if (!/\bloading\s*=/i.test(next)) {
            if (current < 2) {
                // Provável imagem de topo: não atrasar, é candidata a LCP.
                next += ' loading="eager"';
                if (!/\bfetchpriority\s*=/i.test(next)) {
                    next += ' fetchpriority="high"';
                }
            } else {
                next += ' loading="lazy"';
            }
            changed = true;
        }

        if (!changed) return full;
        touched++;
        return `<img${next}${selfClose}>`;
    });

    return { html: out, touched };
}

// ------------------------------------------------------------------ execução

const files = findHtmlFiles(ROOT);

if (files.length === 0) {
    console.error('Nenhum arquivo .html encontrado.');
    process.exit(1);
}

let filesChanged = 0;
let cssAdded = 0;
let jsAdded = 0;
let imgsTouched = 0;
let skipped = 0;

for (const file of files) {
    const original = fs.readFileSync(file, 'utf8');
    let html = original;
    const notes = [];

    if (isFragment(original)) {
        skipped++;
        const relFrag = path.relative(ROOT, file).split(path.sep).join('/');
        console.log(`  (fragmento, ignorado) ${relFrag}`);
        continue;
    }

    const css = injectCss(html, relativeTo(file, 'css/motion.css'));
    html = css.html;
    if (css.changed) {
        cssAdded++;
        notes.push('css');
    }

    for (const script of SCRIPTS) {
        const js = injectJs(html, relativeTo(file, script), script);
        html = js.html;
        if (js.changed) {
            jsAdded++;
            notes.push(path.basename(script));
        }
    }

    const order = normalizeScriptOrder(html);
    html = order.html;
    if (order.changed) notes.push('ordem dos scripts');

    const imgs = applyImageAttrs(html);
    html = imgs.html;
    if (imgs.touched > 0) {
        imgsTouched += imgs.touched;
        notes.push(`${imgs.touched} img`);
    }

    if (html === original) continue;

    filesChanged++;
    const rel = path.relative(ROOT, file).split(path.sep).join('/');
    console.log(`${DRY_RUN ? '[dry-run] ' : ''}${rel}  →  ${notes.join(', ')}`);

    if (!DRY_RUN) fs.writeFileSync(file, html, 'utf8');
}

console.log('');
console.log(`Páginas analisadas : ${files.length}`);
console.log(`Fragmentos pulados : ${skipped}`);
console.log(`Páginas alteradas  : ${filesChanged}`);
console.log(`  motion.css       : ${cssAdded}`);
console.log(`  motion.js        : ${jsAdded}`);
console.log(`  imagens ajustadas: ${imgsTouched}`);
if (DRY_RUN) console.log('\n(dry-run: nenhum arquivo foi escrito)');
