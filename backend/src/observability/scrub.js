/**
 * observability/scrub.js — barreira de PII antes de qualquer envio externo.
 *
 * Regra do projeto (AGENTS.md §9): nunca sai daqui CPF, endereço, telefone ou
 * e-mail de aluno, responsável ou professor. Isso vale em dobro para provedor
 * externo — log interno fica no Render, evento de APM fica num terceiro.
 *
 * Reaproveita `utils/logSanitizer`, que já é a fonte de verdade de masking do
 * sistema, em vez de manter uma segunda lista de padrões que sairia de sincronia.
 */

const { sanitize, scrubString } = require('../utils/logSanitizer');

/**
 * Campos de contexto que NUNCA acompanham um evento, mesmo mascarados.
 * Identificam a pessoa mesmo sem o valor bruto.
 */
const DROP_KEYS = new Set([
    'cpf',
    'rg',
    'documento',
    'endereco',
    'logradouro',
    'cep',
    'complemento',
    'numero_casa',
    'telefone',
    'celular',
    'whatsapp',
    'email',
    'email_responsavel',
    'email_aluno',
    'nome',
    'nome_aluno',
    'nome_responsavel',
    'nome_completo',
    'data_nascimento',
    'nascimento',
    'senha',
    'password',
    'token',
    'authorization',
    'cookie',
]);

/** Querystrings que carregam identificador pessoal. */
const SENSITIVE_QUERY = /([?&])(cpf|email|telefone|token|senha|password|codigo)=[^&]*/gi;

function scrubUrl(url) {
    if (typeof url !== 'string') return url;
    return url.replace(SENSITIVE_QUERY, '$1$2=[REDACTED]');
}

/** Remove chave sensível e mascara o resto, recursivamente. */
function scrubObject(input, depth = 0) {
    if (depth > 6 || input == null) return input;

    if (Array.isArray(input)) {
        return input.map((item) => scrubObject(item, depth + 1));
    }

    if (typeof input === 'string') return scrubString(input);
    if (typeof input !== 'object') return input;

    const out = {};
    for (const [key, value] of Object.entries(input)) {
        if (DROP_KEYS.has(String(key).toLowerCase())) {
            out[key] = '[REDACTED]';
            continue;
        }
        out[key] = scrubObject(value, depth + 1);
    }
    return out;
}

/**
 * Higieniza um evento no formato do Sentry antes do envio.
 * Serve de `beforeSend`/`beforeSendTransaction`.
 */
function scrubEvent(event) {
    if (!event) return event;

    try {
        // Identidade: mantém só o que permite agrupar, nunca o que identifica.
        if (event.user) {
            event.user = {
                id: event.user.id,
                perfil: event.user.perfil,
                escolaId: event.user.escolaId,
            };
        }

        if (event.request) {
            event.request.url = scrubUrl(event.request.url);
            delete event.request.cookies;
            delete event.request.data;
            if (event.request.headers) {
                delete event.request.headers.authorization;
                delete event.request.headers.cookie;
                delete event.request.headers['x-csrf-token'];
            }
            if (event.request.query_string) {
                event.request.query_string = scrubUrl(`?${event.request.query_string}`).slice(1);
            }
        }

        if (event.extra) event.extra = scrubObject(event.extra);
        if (event.tags) event.tags = scrubObject(event.tags);
        if (event.contexts) event.contexts = scrubObject(event.contexts);

        if (event.message) event.message = scrubString(event.message);

        if (Array.isArray(event.breadcrumbs)) {
            event.breadcrumbs = event.breadcrumbs.map((crumb) => ({
                ...crumb,
                message: crumb.message ? scrubString(crumb.message) : crumb.message,
                data: crumb.data ? scrubObject(crumb.data) : crumb.data,
            }));
        }

        if (event.exception && Array.isArray(event.exception.values)) {
            event.exception.values.forEach((value) => {
                if (value.value) value.value = scrubString(value.value);
            });
        }
    } catch (_err) {
        // Se a higienização falhar, o evento NÃO sai. Vazar é pior que perder.
        return null;
    }

    return event;
}

module.exports = {
    scrubEvent,
    scrubObject,
    scrubUrl,
    /** `sanitize` do logSanitizer, reexportado para uso direto. */
    sanitize,
    DROP_KEYS,
};
