#!/usr/bin/env node
/**
 * handlers-inline.js — acha handlers inline (`onclick="..."`) no frontend
 * (Issues #613 e #619, épico #612).
 *
 * A CSP tem `script-src-attr 'none'`: o navegador não executa atributo de
 * evento, e o handler simplesmente não funciona. O teste
 * `handlersInline.trava.test.js` reprova o CI se qualquer arquivo tiver um.
 *
 *   node scripts/handlers-inline.js   mostra os que existirem, por arquivo
 *
 * Conta atributo de evento seguido de aspas — no HTML e nas strings que o JS
 * joga em `innerHTML`. `el.onclick = fn` (propriedade, não atributo) e o
 * `onClick={...}` do React não contam: a CSP não os bloqueia.
 */
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const RAIZ = path.join(__dirname, '..');

const PASTAS = ['html/', 'direcao/', 'detalhes/', 'graficos/', 'js/'];
const IGNORAR = [/^js\/libs\//, /\.min\.js$/, /^js\/vendor\.js$/];
const HANDLER = /(?<=[\s"'])on[a-z]{3,}\s*=\s*\\?["'`]/g;

/** Arquivos do frontend rastreados pelo git — o disco tem relatório gerado. */
function arquivosDoFrontend() {
    const saida = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], {
        cwd: RAIZ,
        encoding: 'utf8',
    });
    return saida
        .split('\n')
        .filter((f) => /\.(html|js)$/.test(f))
        .filter((f) => f === 'index.html' || PASTAS.some((p) => f.startsWith(p)))
        .filter((f) => !IGNORAR.some((re) => re.test(f)))
        .filter((f) => fs.existsSync(path.join(RAIZ, f)))
        .sort();
}

/** `{ arquivo: quantidade }`, só com quem tem pelo menos um. */
function contar() {
    const contagem = {};
    for (const arquivo of arquivosDoFrontend()) {
        const texto = fs.readFileSync(path.join(RAIZ, arquivo), 'utf8');
        const n = (texto.match(HANDLER) || []).length;
        if (n > 0) contagem[arquivo] = n;
    }
    return contagem;
}

function total(contagem) {
    return Object.values(contagem).reduce((soma, n) => soma + n, 0);
}

if (require.main === module) {
    const contagem = contar();
    for (const [arquivo, n] of Object.entries(contagem))
        console.log(`${String(n).padStart(4)}  ${arquivo}`);
    console.log(`${String(total(contagem)).padStart(4)}  total`);
    if (total(contagem) > 0) process.exitCode = 1;
}

module.exports = { contar };
