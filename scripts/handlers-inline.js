#!/usr/bin/env node
/**
 * handlers-inline.js — conta os handlers inline (`onclick="..."`) do frontend
 * (Issue #613, épico #612).
 *
 * Eles são o motivo de a CSP ainda ter `script-src-attr 'unsafe-inline'`. A
 * contagem por arquivo fica gravada em `scripts/handlers-inline.json`, e o
 * teste `handlersInline.trava.test.js` reprova o CI se um arquivo SUBIR o
 * número — handler novo não entra — ou se baixar sem a trava acompanhar, para
 * que ela diga sempre quanto falta.
 *
 *   node scripts/handlers-inline.js           mostra a contagem
 *   node scripts/handlers-inline.js --gravar  atualiza a trava
 *
 * Conta atributo de evento seguido de aspas — no HTML e nas strings que o JS
 * joga em `innerHTML`. `el.onclick = fn` (propriedade, não atributo) e o
 * `onClick={...}` do React não contam: a CSP não os bloqueia.
 */
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const RAIZ = path.join(__dirname, '..');
const TRAVA = path.join(__dirname, 'handlers-inline.json');

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

function lerTrava() {
    return JSON.parse(fs.readFileSync(TRAVA, 'utf8'));
}

function total(contagem) {
    return Object.values(contagem).reduce((soma, n) => soma + n, 0);
}

if (require.main === module) {
    const contagem = contar();
    if (process.argv.includes('--gravar')) {
        fs.writeFileSync(TRAVA, `${JSON.stringify(contagem, null, 4)}\n`);
        console.log(
            `Trava atualizada: ${total(contagem)} handlers em ${Object.keys(contagem).length} arquivos.`
        );
    } else {
        for (const [arquivo, n] of Object.entries(contagem))
            console.log(`${String(n).padStart(4)}  ${arquivo}`);
        console.log(`${String(total(contagem)).padStart(4)}  total`);
    }
}

module.exports = { contar, lerTrava };
