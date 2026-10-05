/**
 * cspRelatorio.js — a CSP sem handler inline, primeiro só observando
 * (Issue #613, épico #612).
 *
 * A política de verdade (app.js) ainda tem `script-src-attr 'unsafe-inline'`
 * por causa dos handlers inline do frontend legado. Antes de trocar por
 * `'none'`, esta segunda política, em modo RELATÓRIO, aplica `'none'` sem
 * bloquear nada: o navegador só avisa, em `POST /api/csp-relatorio`, cada
 * handler inline que teria sido barrado. A produção passa a dizer o que ainda
 * falta — inclusive o que a contagem estática (`scripts/handlers-inline.js`)
 * não enxerga, como atributo montado por concatenação.
 *
 * O registro guarda página, diretiva, arquivo e linha, só com o caminho: a
 * URL da página pode ter query com dado pessoal, e o relatório vem de qualquer
 * navegador, sem sessão — por isso o teto por IP e o corpo pequeno.
 */
const express = require('express');
const helmet = require('helmet');
const logger = require('../utils/logger');

const ROTA = '/api/csp-relatorio';
const MAX_ITENS = 20;

/**
 * Política só de observação: não muda o que roda na página.
 *
 * Sem `default-src` de propósito: com ele, o navegador avisaria de tudo que a
 * diretiva padrão não cobre, e o relatório deixaria de ser sobre handler
 * inline. Numa política em relatório isso não abre nada — a que protege é a do
 * app.js. O helmet exige que a ausência seja declarada.
 */
const politicaEmRelatorio = helmet.contentSecurityPolicy({
    useDefaults: false,
    reportOnly: true,
    directives: {
        'default-src': helmet.contentSecurityPolicy.dangerouslyDisableDefaultSrc,
        'script-src-attr': ["'none'"],
        'report-uri': [ROTA],
    },
});

/** Só o caminho: sem host, query nem fragmento. */
function soCaminho(valor) {
    if (typeof valor !== 'string' || !valor) return undefined;
    if (valor === 'inline' || valor === 'eval') return valor;
    try {
        return new URL(valor, 'http://local').pathname.slice(0, 200);
    } catch {
        return undefined;
    }
}

/**
 * Aceita os dois formatos que os navegadores mandam: o antigo
 * (`{"csp-report": {...}}`, `report-uri`) e o da Reporting API
 * (`[{ "type": "csp-violation", "body": {...} }]`).
 */
function resumir(item) {
    const r = item?.['csp-report'] || item?.body || item || {};
    const diretiva = String(
        r['effective-directive'] ?? r['violated-directive'] ?? r.effectiveDirective ?? ''
    ).slice(0, 64);
    return {
        pagina: soCaminho(r['document-uri'] ?? r.documentURL),
        diretiva: diretiva || undefined,
        arquivo: soCaminho(r['source-file'] ?? r.sourceFile),
        linha: Number(r['line-number'] ?? r.lineNumber) || undefined,
    };
}

const lerRelatorio = express.json({
    type: ['application/csp-report', 'application/reports+json', 'application/json'],
    limit: '16kb',
});

function receberRelatorio(req, res) {
    const itens = Array.isArray(req.body) ? req.body.slice(0, MAX_ITENS) : [req.body];
    for (const item of itens) {
        const violacao = resumir(item);
        if (!violacao.diretiva) continue;
        logger.warn('[csp] Handler inline que a política nova bloquearia', {
            ...violacao,
            action: 'csp.violacao',
        });
    }
    res.status(204).end();
}

module.exports = {
    ROTA,
    // Logo depois do helmet: vale também para os arquivos estáticos.
    politicaEmRelatorio,
    // Antes do `csrfValidator`: o navegador manda o relatório sozinho, sem token.
    receberRelatorioCsp: [lerRelatorio, receberRelatorio],
    resumir,
};
