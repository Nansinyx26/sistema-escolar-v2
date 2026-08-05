/**
 * logSanitizer.js — Data Masking para logs (Observabilidade / LGPD)
 *
 * Garante que segredos e dados pessoais nunca cheguem ao destino do log.
 * Módulo puro (sem dependências) — usado tanto pelo `utils/logger.js` quanto
 * pelo `redact` do Pino, e testável isoladamente.
 *
 * Três camadas de defesa:
 *   1. Deny-list por NOME de chave  → `senha`, `token`, `codigoSecreto`… → '[REDACTED]'
 *   2. Mascaramento parcial de PII  → e-mail/CPF/telefone viram forma diagnosticável
 *      mas não identificável (`j***@g***.com`), preservando utilidade do log.
 *   3. Varredura de VALOR em texto  → JWT, Bearer, chaves de API e CPF soltos
 *      dentro de mensagens livres (ex.: `err.message` com o payload embutido).
 *
 * A camada 3 é a que mais importa: a maioria dos vazamentos reais não vem de um
 * campo bem-nomeado, e sim de um erro cuja mensagem carrega o payload inteiro.
 */

'use strict';

const REDACTED = '[REDACTED]';
const TRUNCATED = '…[truncado]';

/** Limites anti-DoS: um log jamais deve derrubar o processo nem inundar o disco. */
const MAX_DEPTH = 6;
const MAX_ARRAY_ITEMS = 50;
const MAX_STRING_LENGTH = 2000;
const MAX_KEYS_PER_OBJECT = 60;

/**
 * Chaves cujo valor é sempre segredo — removidas por completo.
 * Comparação: minúsculas, sem `_`/`-`, por substring (pega `novaSenha`,
 * `senha_atual`, `refreshToken`, `x-access-token`…).
 */
const SECRET_KEY_PATTERNS = [
    'senha', 'password', 'passwd', 'pwd',
    'token', 'jwt', 'bearer', 'authorization', 'cookie', 'session',
    'secret', 'apikey', 'privatekey', 'clientsecret', 'credential',
    'hash', 'salt', 'otp', 'twofactor', '2fa', 'codigo2fa',
    'codigosecreto', 'codigoacesso', 'resetcode', 'recoverycode',
    'mongodburi', 'databaseurl', 'connectionstring', 'dsn',
    'signature', 'csrf', 'xsrf',
];

/**
 * Chaves de dado pessoal — preservadas de forma parcial para permitir
 * correlacionar sessões sem expor o titular (LGPD art. 12).
 */
const PII_KEY_PATTERNS = ['email', 'cpf', 'rg', 'telefone', 'celular', 'phone', 'endereco', 'cep'];

/**
 * Chaves com nome pessoal. Em log só interessa o identificador, não o nome —
 * especialmente aqui, onde os titulares são menores de idade.
 */
const NAME_KEY_PATTERNS = ['nome', 'name', 'nomecompleto', 'nomemae', 'nomepai', 'responsavelnome'];

/** Normaliza a chave para casar com os padrões acima. */
function normalizeKey(key) {
    return String(key).toLowerCase().replace(/[_\-\s.]/g, '');
}

function matchesAny(normalizedKey, patterns) {
    return patterns.some(p => normalizedKey.includes(p));
}

/* ------------------------------------------------------------------ *
 * Camada 2 — mascaramento parcial de PII
 * ------------------------------------------------------------------ */

/** `joao.silva@gmail.com` → `j***@g***.com` */
function maskEmail(value) {
    const str = String(value);
    const at = str.indexOf('@');
    if (at < 1) return REDACTED;

    const local = str.slice(0, at);
    const domain = str.slice(at + 1);
    const dot = domain.lastIndexOf('.');
    const tld = dot > -1 ? domain.slice(dot) : '';

    return `${local[0]}***@${domain[0] || ''}***${tld}`;
}

/** Mantém só os 2 últimos dígitos: `***.***.**9-11` */
function maskDocument(value) {
    const digits = String(value).replace(/\D/g, '');
    if (digits.length < 4) return REDACTED;
    return `***${digits.slice(-2)}`;
}

/** `Maria Aparecida Souza` → `M. A. S.` — suficiente para depurar, inútil para identificar. */
function maskName(value) {
    const str = String(value).trim();
    if (!str) return REDACTED;
    return str
        .split(/\s+/)
        .slice(0, 4)
        .map(part => (part[0] ? `${part[0].toUpperCase()}.` : ''))
        .join(' ');
}

/* ------------------------------------------------------------------ *
 * Camada 3 — varredura de segredos dentro de strings livres
 * ------------------------------------------------------------------ */

const VALUE_SCRUBBERS = [
    // JWT (três segmentos base64url) — o vazamento mais comum em err.message
    { re: /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\b/g, to: '[JWT_REDACTED]' },
    // Authorization: Bearer <algo>
    { re: /\b(bearer|basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi, to: '$1 [REDACTED]' },
    // Credenciais embutidas em URI de conexão (mongodb://user:pass@host)
    { re: /(\b[a-z][a-z0-9+.-]*:\/\/)([^:@/\s]+):([^@/\s]+)@/gi, to: '$1$2:[REDACTED]@' },
    // Atribuições inline: senha=..., token: "...", apiKey => ...
    {
        re: /\b(senha|password|pwd|token|secret|apikey|api_key|authorization|codigo)\b(\s*[:=]{1,2}>?\s*)("[^"]*"|'[^']*'|[^\s,;}&]+)/gi,
        to: '$1$2[REDACTED]',
    },
    // CPF em texto livre (com ou sem pontuação)
    { re: /\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g, to: '[CPF_REDACTED]' },
    // E-mail em texto livre
    {
        re: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
        to: (m) => maskEmail(m),
    },
    // Chaves de API de provedores (OpenAI, Google, ElevenLabs…)
    { re: /\b(sk|pk|rk)[-_][A-Za-z0-9_-]{16,}\b/g, to: '[APIKEY_REDACTED]' },
    { re: /\bAIza[0-9A-Za-z_-]{30,}\b/g, to: '[APIKEY_REDACTED]' },
];

/** Aplica os scrubbers de valor e trunca strings gigantes. */
function scrubString(value) {
    let out = String(value);

    for (const { re, to } of VALUE_SCRUBBERS) {
        re.lastIndex = 0;
        out = out.replace(re, to);
    }

    if (out.length > MAX_STRING_LENGTH) {
        out = out.slice(0, MAX_STRING_LENGTH) + TRUNCATED;
    }
    return out;
}

/* ------------------------------------------------------------------ *
 * Travessia principal
 * ------------------------------------------------------------------ */

/**
 * Sanitiza qualquer valor para gravação em log.
 * Trata ciclos, Error, Date, Buffer, Map/Set e ObjectId do Mongoose.
 *
 * @param {*} value          Valor a sanitizar
 * @param {object} [options] `{ depth, seen }` — uso interno da recursão
 * @returns {*} Cópia segura, nunca a referência original
 */
function sanitize(value, options = {}) {
    const depth = options.depth || 0;
    const seen = options.seen || new WeakSet();

    if (value === null || value === undefined) return value;

    const type = typeof value;

    if (type === 'string') return scrubString(value);
    if (type === 'number' || type === 'boolean') return value;
    if (type === 'bigint') return `${value}n`;
    if (type === 'symbol') return value.toString();
    if (type === 'function') return `[Function: ${value.name || 'anonymous'}]`;

    if (depth >= MAX_DEPTH) return '[Object: profundidade máxima]';

    // Error: preserva name/message/stack/code — o stack é essencial e não é PII,
    // mas a message frequentemente carrega payload, então passa pelo scrubber.
    if (value instanceof Error) {
        const out = {
            name: value.name,
            message: scrubString(value.message || ''),
        };
        if (value.stack) out.stack = scrubString(value.stack);
        if (value.code !== undefined) out.code = value.code;
        if (value.status !== undefined) out.status = value.status;
        return out;
    }

    if (value instanceof Date) return value.toISOString();
    if (Buffer.isBuffer(value)) return `[Buffer: ${value.length} bytes]`;
    if (value instanceof Map) return sanitize(Object.fromEntries(value), { depth: depth + 1, seen });
    if (value instanceof Set) return sanitize(Array.from(value), { depth: depth + 1, seen });

    if (type === 'object') {
        if (seen.has(value)) return '[Circular]';
        seen.add(value);

        // ObjectId do Mongoose e afins: identificador, não é PII — mantém legível.
        const ctor = value.constructor && value.constructor.name;
        if (ctor === 'ObjectId' || ctor === 'ObjectID') return String(value);

        // Documento Mongoose → objeto simples antes de percorrer.
        if (typeof value.toObject === 'function') {
            try {
                return sanitize(value.toObject(), { depth, seen });
            } catch {
                /* documento parcial/desanexado — segue pela travessia normal */
            }
        }

        if (Array.isArray(value)) {
            const items = value.slice(0, MAX_ARRAY_ITEMS)
                .map(v => sanitize(v, { depth: depth + 1, seen }));
            if (value.length > MAX_ARRAY_ITEMS) {
                items.push(`…mais ${value.length - MAX_ARRAY_ITEMS} item(ns)`);
            }
            return items;
        }

        const out = {};
        const keys = Object.keys(value).slice(0, MAX_KEYS_PER_OBJECT);

        for (const key of keys) {
            const nk = normalizeKey(key);
            const raw = value[key];

            if (matchesAny(nk, SECRET_KEY_PATTERNS)) {
                out[key] = REDACTED;
                continue;
            }

            if (raw !== null && raw !== undefined && typeof raw !== 'object') {
                if (matchesAny(nk, PII_KEY_PATTERNS)) {
                    out[key] = nk.includes('email') ? maskEmail(raw) : maskDocument(raw);
                    continue;
                }
                if (matchesAny(nk, NAME_KEY_PATTERNS)) {
                    out[key] = maskName(raw);
                    continue;
                }
            }

            out[key] = sanitize(raw, { depth: depth + 1, seen });
        }

        const hidden = Object.keys(value).length - keys.length;
        if (hidden > 0) out['…'] = `mais ${hidden} campo(s) omitido(s)`;

        return out;
    }

    return String(value);
}

/**
 * Caminhos de `redact` para o Pino. Cobrem os campos que o pino serializa
 * antes de a nossa travessia rodar (req/res/headers) — cinto e suspensório.
 */
const PINO_REDACT_PATHS = [
    'req.headers.authorization',
    'req.headers.cookie',
    'req.headers["x-access-token"]',
    'req.headers["x-csrf-token"]',
    'res.headers["set-cookie"]',
    'headers.authorization',
    'headers.cookie',
    '*.senha', '*.password', '*.token', '*.accessToken', '*.refreshToken',
    '*.codigoSecreto', '*.twoFactorPendingToken',
    'senha', 'password', 'token', 'codigo', 'codigoSecreto',
];

module.exports = {
    sanitize,
    scrubString,
    maskEmail,
    maskDocument,
    maskName,
    normalizeKey,
    PINO_REDACT_PATHS,
    REDACTED,
    _internals: { SECRET_KEY_PATTERNS, PII_KEY_PATTERNS, NAME_KEY_PATTERNS, VALUE_SCRUBBERS },
};
