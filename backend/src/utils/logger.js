/**
 * logger.js — Logger estruturado do Sistema Escolar (Observabilidade)
 *
 * Motor: **Pino** (JSON de alta performance, escrita assíncrona).
 * Em desenvolvimento, `pino-pretty` formata de forma legível.
 *
 * Níveis: debug < info < warn < error < fatal
 *
 * ┌─ Três garantias desta camada ────────────────────────────────────┐
 * │ 1. TUDO que é logado passa por `logSanitizer` (Data Masking).    │
 * │    Senhas, tokens, CPF e nomes nunca chegam ao destino, mesmo    │
 * │    que embutidos no meio de uma mensagem de erro.                │
 * │ 2. requestId / userId / perfil / escolaId / action entram        │
 * │    automaticamente via AsyncLocalStorage — sem passar `req`.     │
 * │ 3. A API pública é a mesma de antes, então os call sites que já  │
 * │    existem continuam válidos sem nenhuma edição.                 │
 * └──────────────────────────────────────────────────────────────────┘
 *
 * Uso:
 *   const logger = require('./utils/logger');
 *   logger.info('Servidor iniciado', { port: 3001 });
 *   logger.error('Falha ao salvar nota', err);            // Error direto
 *   logger.error('Falha ao salvar nota', { err, notaId }); // ou dentro do meta
 */

'use strict';

const { sanitize, PINO_REDACT_PATHS } = require('./logSanitizer');
const logContext = require('./logContext');

const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const IS_TEST = process.env.NODE_ENV === 'test';
const LOG_LEVEL = (process.env.LOG_LEVEL || (IS_PRODUCTION ? 'info' : 'debug')).toLowerCase();

/* ------------------------------------------------------------------ *
 * Motor de escrita
 * ------------------------------------------------------------------ */

/**
 * Cria a instância Pino. Se o pacote ainda não estiver instalado
 * (deploy antes do `npm install`), cai para um emissor JSON nativo com o
 * mesmo formato de saída — o app nunca deixa de subir por causa do logger.
 */
function createEngine() {
    try {
        const pino = require('pino');

        const options = {
            level: LOG_LEVEL,

            // Cinto e suspensório: o `redact` do Pino atua sobre campos que ele
            // serializa por conta própria; o `sanitize()` cobre o resto.
            redact: { paths: PINO_REDACT_PATHS, censor: '[REDACTED]' },

            // Injeta o contexto da requisição em CADA log, automaticamente.
            mixin() {
                return logContext.get();
            },

            formatters: {
                level: (label) => ({ level: label }),
            },

            base: { pid: process.pid, env: process.env.NODE_ENV || 'development' },
            timestamp: () => `,"timestamp":"${new Date().toISOString()}"`,
            messageKey: 'message',
        };

        if (!IS_PRODUCTION && !IS_TEST) {
            try {
                require.resolve('pino-pretty');
                options.transport = {
                    target: 'pino-pretty',
                    options: {
                        colorize: true,
                        translateTime: 'SYS:yyyy-mm-dd HH:MM:ss',
                        ignore: 'pid,env',
                        messageKey: 'message',
                    },
                };
            } catch {
                /* sem pino-pretty → JSON puro também em dev, tudo bem */
            }
        }

        // Destino explícito através de `process.stdout.write`, em vez do
        // descritor de arquivo cru que o Pino usa por padrão. Motivo: escrever
        // direto no fd 1 driblaria qualquer redirecionamento de stdout — o que
        // torna o comportamento impossível de verificar em teste e imprevisível
        // sob supervisores que reencaminham a saída. O custo é desprezível no
        // volume desta aplicação.
        const destino = { write: (linha) => { process.stdout.write(linha); } };

        return { kind: 'pino', instance: pino(options, destino) };
    } catch {
        return { kind: 'fallback', instance: createFallbackEngine() };
    }
}

/** Emissor JSON mínimo, formato idêntico ao do Pino configurado acima. */
function createFallbackEngine() {
    const ORDER = { debug: 20, info: 30, warn: 40, error: 50, fatal: 60 };
    const threshold = ORDER[LOG_LEVEL] || ORDER.debug;

    const write = (level) => (obj, message) => {
        if (ORDER[level] < threshold) return;
        const entry = {
            level,
            timestamp: new Date().toISOString(),
            pid: process.pid,
            env: process.env.NODE_ENV || 'development',
            message,
            ...logContext.get(),
            ...obj,
        };
        // Todos os níveis em stdout, igual ao Pino: o nível é um campo do JSON,
        // não o canal. Separar em stderr embaralharia a ordem dos eventos no
        // agregador, que é justamente o que se quer preservar num incidente.
        process.stdout.write(JSON.stringify(entry) + '\n');
    };

    return {
        debug: write('debug'), info: write('info'), warn: write('warn'),
        error: write('error'), fatal: write('fatal'),
    };
}

const engine = createEngine();
const sink = engine.instance;

/* ------------------------------------------------------------------ *
 * Normalização de argumentos
 * ------------------------------------------------------------------ */

/**
 * Aceita as formas usadas no projeto e devolve um meta já sanitizado:
 *   logger.error('msg')
 *   logger.error('msg', err)                    // Error na 2ª posição
 *   logger.error('msg', { err, userId })
 *   logger.error('msg', err, { userId })        // assinatura do antigo LoggerService
 */
function buildMeta(metaOrError, extra) {
    let meta = {};

    if (metaOrError instanceof Error) {
        meta.err = metaOrError;
        if (extra && typeof extra === 'object') Object.assign(meta, extra);
    } else if (metaOrError && typeof metaOrError === 'object') {
        meta = { ...metaOrError };
        if (extra && typeof extra === 'object') Object.assign(meta, extra);
    } else if (metaOrError !== undefined) {
        meta.detail = metaOrError;
    }

    // A sanitização é o último passo antes da escrita — nada escapa dela.
    const safe = sanitize(meta);
    return (safe && typeof safe === 'object' && !Array.isArray(safe)) ? safe : { detail: safe };
}

function emit(level, message, metaOrError, extra) {
    const meta = buildMeta(metaOrError, extra);
    // A própria mensagem também é varrida: erros costumam concatenar payload nela.
    sink[level](meta, sanitize(String(message ?? '')));
}

/* ------------------------------------------------------------------ *
 * Alertas com deduplicação
 * ------------------------------------------------------------------ */

const _alertCooldowns = new Map();
const ALERT_COOLDOWN_MS = 5 * 60 * 1000;

/**
 * Alerta estruturado para falhas críticas, com cooldown por fingerprint
 * para evitar inundar o agregador durante um incidente.
 *
 * Diferente da versão anterior, um alerta suprimido NÃO desaparece: ele vira
 * um `warn` com `suppressed: true`, para que a frequência real do incidente
 * continue visível nos painéis.
 */
function alert(type, message, context = {}) {
    const fingerprint = `${type}:${message}`;
    const now = Date.now();
    const last = _alertCooldowns.get(fingerprint);

    if (last && (now - last) < ALERT_COOLDOWN_MS) {
        emit('warn', `[ALERTA suprimido: ${type}] ${message}`, {
            ...context, alertType: type, suppressed: true,
            sinceLastMs: now - last,
        });
        return;
    }
    _alertCooldowns.set(fingerprint, now);

    if (_alertCooldowns.size > 500) {
        for (const [key, ts] of _alertCooldowns) {
            if (now - ts > ALERT_COOLDOWN_MS * 2) _alertCooldowns.delete(key);
        }
    }

    emit('fatal', `🚨 [ALERTA: ${type}] ${message}`, {
        ...context, alertType: type, severity: 'critical',
    });
}

/* ------------------------------------------------------------------ *
 * API pública
 * ------------------------------------------------------------------ */

const logger = {
    debug: (msg, meta, extra) => emit('debug', msg, meta, extra),
    info: (msg, meta, extra) => emit('info', msg, meta, extra),
    warn: (msg, meta, extra) => emit('warn', msg, meta, extra),
    error: (msg, meta, extra) => emit('error', msg, meta, extra),
    fatal: (msg, meta, extra) => emit('fatal', msg, meta, extra),
    alert,

    /** Contexto da requisição — reexportado por conveniência. */
    context: logContext,
    setAction: logContext.setAction,

    /**
     * Logger com campos fixos, para um job ou serviço:
     *   const log = logger.child({ job: 'DailyDigest' });
     */
    child(bindings = {}) {
        const safe = sanitize(bindings);
        const wrap = (level) => (msg, meta, extra) =>
            emit(level, msg, { ...safe, ...buildMeta(meta, extra) });
        return {
            debug: wrap('debug'), info: wrap('info'), warn: wrap('warn'),
            error: wrap('error'), fatal: wrap('fatal'),
            alert: (type, msg, ctx = {}) => alert(type, msg, { ...safe, ...ctx }),
            child: (more) => logger.child({ ...bindings, ...more }),
        };
    },

    /** Diagnóstico: qual motor está ativo. */
    _engine: engine.kind,
};

module.exports = logger;
