/**
 * cspHashes.js — permite scripts inline SEM `'unsafe-inline'`.
 *
 * O PROBLEMA
 * ----------
 * A CSP tinha `script-src: 'unsafe-inline'`, que é o mesmo que desligar a
 * proteção contra XSS refletido/armazenado: qualquer `<script>` que um atacante
 * consiga injetar na página executa, porque a política autoriza *todo* script
 * inline sem distinção.
 *
 * A SOLUÇÃO ESCOLHIDA — hashes, não nonces
 * -----------------------------------------
 * Nonce exige um valor novo por RESPOSTA, o que obriga o HTML a ser gerado
 * dinamicamente. Aqui as páginas são arquivos estáticos servidos por
 * `express.static`, então nonce implicaria reescrever HTML a cada request.
 *
 * Hash (`sha256-...`) resolve sem tocar no HTML: o browser calcula o SHA-256 do
 * conteúdo de cada `<script>` inline e só executa se bater com um da lista.
 * Script injetado por atacante tem conteúdo diferente → hash diferente → não
 * executa. E quando a CSP traz hashes, o browser IGNORA `'unsafe-inline'`
 * (CSP nível 2+), então a diretiva antiga deixa de valer mesmo se alguém a
 * reintroduzir por engano.
 *
 * POR QUE CALCULAR EM RUNTIME, E NÃO NUM BUILD
 * --------------------------------------------
 * Os hashes saem dos MESMOS bytes que o servidor entrega. Um passo de build
 * separado sairia de sincronia no dia em que alguém editasse o HTML sem
 * rodá-lo — e a falha apareceria como página quebrada em produção, não como
 * erro de build. Aqui isso é impossível por construção.
 *
 * LIMITE CONHECIDO: handlers inline (`onclick="..."`) NÃO são cobertos por
 * hashes de `script-src` — eles caem em `script-src-attr`, tratado à parte.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Diretórios/arquivos HTML efetivamente servidos (espelha app.js)
const ALVOS = ['index.html', 'html', 'detalhes', 'direcao', 'graficos', 'portal-responsavel/dist'];

const RE_SCRIPT = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;

function listarHtml(raiz, alvo, acc = []) {
    const p = path.join(raiz, alvo);
    let st;
    try {
        st = fs.statSync(p);
    } catch {
        return acc;
    }

    if (st.isFile()) {
        if (p.endsWith('.html')) acc.push(p);
        return acc;
    }
    let entradas;
    try {
        entradas = fs.readdirSync(p);
    } catch {
        return acc;
    }
    for (const e of entradas) listarHtml(p, e, acc);
    return acc;
}

/**
 * Varre os HTML servidos e devolve os hashes CSP dos scripts inline.
 * @returns {{hashes: string[], arquivos: number, blocos: number, maisRecente: number}}
 */
function calcularHashes(raizFrontend) {
    const arquivos = ALVOS.flatMap((a) => listarHtml(raizFrontend, a));
    const hashes = new Set();
    let blocos = 0;
    let maisRecente = 0;

    for (const arquivo of arquivos) {
        let html;
        try {
            html = fs.readFileSync(arquivo, 'utf8');
            maisRecente = Math.max(maisRecente, fs.statSync(arquivo).mtimeMs);
        } catch {
            continue;
        }

        for (const m of html.matchAll(RE_SCRIPT)) {
            const atributos = m[1];
            const corpo = m[2];

            // `<script src=...>` é external: coberto por 'self'/allowlist de host.
            if (/\bsrc\s*=/i.test(atributos)) continue;
            // Blocos vazios não geram execução.
            if (!corpo.trim()) continue;
            // `type` não-executável (application/json, text/template…) é dado, não script.
            const tipo = /\btype\s*=\s*["']?([^"'\s>]+)/i.exec(atributos)?.[1]?.toLowerCase();
            if (tipo && !['text/javascript', 'module', 'application/javascript'].includes(tipo))
                continue;

            // CRÍTICO: o browser hasheia o conteúdo EXATO entre as tags, sem
            // aparar espaços. Não normalize NADA além das quebras de linha.
            //
            // As quebras são a exceção, e por exigência do próprio HTML: o
            // parser converte `\r\n` e `\r` soltos em `\n` ANTES de o conteúdo
            // virar o texto do script. Ou seja, o browser hasheia o texto já
            // normalizado — hashear os bytes crus do disco é que estava errado.
            //
            // Consequência prática, e o motivo da Issue #27: em checkout
            // Windows o Git grava CRLF, os hashes deixavam de bater e a CSP
            // bloqueava TODO script inline. O sistema não abria na máquina de
            // quem desenvolve, enquanto produção (Linux, LF) seguia normal.
            // Verificado: os hashes que o Chrome exigia batem com o conteúdo
            // normalizado e com nenhum dos crus.
            const corpoNormalizado = corpo.replace(/\r\n?/g, '\n');
            hashes.add(
                `'sha256-${crypto.createHash('sha256').update(corpoNormalizado, 'utf8').digest('base64')}'`
            );
            blocos++;
        }
    }

    return { hashes: [...hashes], arquivos: arquivos.length, blocos, maisRecente };
}

// ── Cache ────────────────────────────────────────────────────────────────────
// Em produção calcula uma vez no boot (os arquivos não mudam sob o processo).
// Fora de produção revalida por mtime, senão editar um script inline durante o
// desenvolvimento derrubaria a página com um erro de CSP difícil de associar
// à causa.
const isProduction = process.env.NODE_ENV === 'production';
const INTERVALO_REVALIDACAO_MS = 2000;

let cache = null;
let ultimaChecagem = 0;

function obterHashes(raizFrontend) {
    const agora = Date.now();

    if (cache && (isProduction || agora - ultimaChecagem < INTERVALO_REVALIDACAO_MS)) {
        return cache.hashes;
    }

    if (cache && !isProduction) {
        ultimaChecagem = agora;
        const atual = calcularHashes(raizFrontend);
        if (atual.maisRecente !== cache.maisRecente) {
            cache = atual;
            console.log(`🔒 [CSP] HTML alterado — ${atual.blocos} scripts inline re-hasheados.`);
        }
        return cache.hashes;
    }

    cache = calcularHashes(raizFrontend);
    ultimaChecagem = agora;
    console.log(
        `🔒 [CSP] ${cache.blocos} scripts inline autorizados por hash em ${cache.arquivos} arquivos HTML (sem 'unsafe-inline').`
    );
    return cache.hashes;
}

module.exports = { obterHashes, calcularHashes };
