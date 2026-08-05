/**
 * consoleGuard.js — Rede de segurança para `console.*` remanescente
 *
 * O backend ainda tem centenas de `console.log/warn/error` herdados. Migrar
 * todos de uma vez é arriscado e demorado; deixá-los como estão significa que
 * essas linhas escapam do Data Masking, saem sem contexto e sem nível — que é
 * exatamente o problema que esta camada existe para resolver.
 *
 * Este módulo redireciona `console.*` para o logger estruturado. Com isso,
 * mesmo o código não migrado passa a:
 *   • ser sanitizado (senha/token/PII nunca chegam ao destino);
 *   • sair em JSON com nível correto;
 *   • herdar requestId/userId/escolaId da requisição em andamento.
 *
 * A migração call-a-call continua valendo (o `origem` abaixo aponta onde
 * migrar), mas deixa de ser pré-requisito para a aplicação estar segura.
 *
 * Mapeamento de nível:
 *   console.error → error   console.warn  → warn
 *   console.info  → info    console.debug → debug
 *   console.log   → info    (era o "nível" mais usado como informativo)
 */

'use strict';

const logger = require('./logger');

let instalado = false;

/**
 * Descobre o arquivo/linha que originou a chamada, pulando os frames deste
 * módulo. Sem isso o log estruturado apontaria sempre para consoleGuard.js.
 */
function origemDaChamada() {
    const err = new Error();
    const linhas = String(err.stack || '').split('\n').slice(2);
    for (const l of linhas) {
        // Pula este módulo, dependências (o Jest também embrulha o console) e
        // frames internos do Node — nenhum deles é a origem real da chamada.
        if (l.includes('consoleGuard')) continue;
        if (l.includes('node_modules')) continue;
        if (l.includes('node:internal')) continue;

        // Ancora no `:linha:coluna` final e trata todo o resto como caminho.
        // Diretórios com espaço ou parênteses (ex.: "projeto (16)") são comuns
        // no Windows e quebram padrões mais restritivos.
        const m = l.match(/(\d+):(\d+)\)?\s*$/);
        if (!m) continue;

        const antes = l.slice(0, l.length - m[0].length).replace(/[(:]\s*$/, '');
        const partes = antes.split(/[/\\]/).filter(Boolean);
        const arquivo = partes[partes.length - 1];
        if (!arquivo || !arquivo.endsWith('.js')) continue;

        const pasta = partes[partes.length - 2];
        return `${pasta ? pasta + '/' : ''}${arquivo}:${m[1]}`;
    }
    return undefined;
}

/**
 * `console.log('Falhou:', err, { id })` vira uma mensagem + meta estruturado,
 * sem perder nenhum argumento pelo caminho.
 */
function normalizar(args) {
    const partesMensagem = [];
    const meta = {};
    let extras = 0;

    for (const arg of args) {
        if (typeof arg === 'string' || typeof arg === 'number' || typeof arg === 'boolean') {
            partesMensagem.push(String(arg));
        } else if (arg instanceof Error) {
            meta.err = arg;
        } else if (arg && typeof arg === 'object') {
            // Objeto simples vira meta; se houver vários, não sobrescreve.
            if (extras === 0) Object.assign(meta, arg);
            else meta[`arg${extras}`] = arg;
            extras++;
        } else if (arg !== undefined) {
            partesMensagem.push(String(arg));
        }
    }

    return { mensagem: partesMensagem.join(' ').trim() || '(sem mensagem)', meta };
}

/**
 * Instala o redirecionamento. Idempotente.
 * @param {object} [opts]
 * @param {boolean} [opts.incluirOrigem=true] anexa `origem: 'arquivo.js:linha'`
 */
function instalar(opts = {}) {
    if (instalado) return;
    instalado = true;

    const incluirOrigem = opts.incluirOrigem !== false;
    const nativo = {
        log: console.log, info: console.info, warn: console.warn,
        error: console.error, debug: console.debug,
    };

    const encaminhar = (nivel) => (...args) => {
        try {
            const { mensagem, meta } = normalizar(args);
            if (incluirOrigem) {
                const origem = origemDaChamada();
                if (origem) meta.origem = origem;
            }
            meta.viaConsole = true;
            logger[nivel](mensagem, meta);
        } catch (e) {
            // Um logger que quebra a aplicação é pior que um log perdido.
            nativo.error('[consoleGuard] falha ao encaminhar log:', e && e.message);
        }
    };

    console.log = encaminhar('info');
    console.info = encaminhar('info');
    console.debug = encaminhar('debug');
    console.warn = encaminhar('warn');
    console.error = encaminhar('error');

    // Guarda o original para testes e para restaurar se necessário.
    console._nativo = nativo;
}

/** Restaura o `console` nativo (usado em testes). */
function desinstalar() {
    if (!instalado || !console._nativo) return;
    Object.assign(console, console._nativo);
    delete console._nativo;
    instalado = false;
}

module.exports = { instalar, desinstalar, normalizar };
