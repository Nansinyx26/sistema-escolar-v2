const sanitizeHtml = require('sanitize-html');

/**
 * Utilitário de sanitização de strings para prevenção contra XSS.
 * Remove tags script, iframes perigosos e atributos on* (ex: onclick, onerror).
 * Mantém tags inofensivas de formatação básica se necessário.
 *
 * @param {string} input - String suja vinda do frontend
 * @returns {string} - String limpa e segura
 */
const sanitizeInput = (input) => {
    if (typeof input !== 'string') {
        return input;
    }

    return sanitizeHtml(input, {
        allowedTags: [], // Por padrão, removemos QUALQUER tag HTML dos inputs (textos puros)
        allowedAttributes: {},
        disallowedTagsMode: 'discard', // Remove completamente a tag em vez de fazer escape
    });
};

/**
 * Função recursiva para sanitizar todos os campos string de um objeto (ex: req.body).
 *
 * @param {Object} obj - Objeto a ser sanitizado
 */
const sanitizeObject = (obj) => {
    if (!obj || typeof obj !== 'object') return;

    Object.keys(obj).forEach((key) => {
        if (typeof obj[key] === 'string') {
            obj[key] = sanitizeInput(obj[key]);
        } else if (typeof obj[key] === 'object' && obj[key] !== null) {
            sanitizeObject(obj[key]);
        }
    });
};

/**
 * NoSQL INJECTION NO BODY.
 *
 * `sanitizeObject` percorria o body recursivamente mas só limpava HTML das
 * strings — as CHAVES passavam intactas. Um JSON como
 *     { "email": { "$ne": null }, "senha": { "$gt": "" } }
 * chegava inteiro ao controller e virava operador de consulta no Mongo.
 * (No /login o `email.toLowerCase()` estourava com TypeError → 500, um acidente
 * feliz; mas qualquer outro handler que jogue um campo do body direto num
 * filtro estava exposto.)
 *
 * Diferente da versão de query/params, aqui NÃO descartamos objetos aninhados:
 * o body legítimo tem estrutura (segundoResponsavel, lgpdConsents,
 * pessoasAutorizadas…). Removemos apenas as chaves perigosas, recursivamente:
 *   - `$...`  → operador de consulta;
 *   - `a.b`   → notação de caminho, usada para escrever campo aninhado
 *               arbitrário num $set;
 *   - chaves de poluição de prototype.
 */
const CHAVES_PROIBIDAS = new Set(['__proto__', 'constructor', 'prototype']);
const PROFUNDIDADE_MAX = 12;

function removerOperadoresMongoProfundo(alvo, profundidade = 0) {
    if (!alvo || typeof alvo !== 'object' || profundidade > PROFUNDIDADE_MAX) return;

    if (Array.isArray(alvo)) {
        alvo.forEach((item) => {
            removerOperadoresMongoProfundo(item, profundidade + 1);
        });
        return;
    }

    Object.keys(alvo).forEach((chave) => {
        if (chave.startsWith('$') || chave.includes('.') || CHAVES_PROIBIDAS.has(chave)) {
            delete alvo[chave];
            return;
        }
        removerOperadoresMongoProfundo(alvo[chave], profundidade + 1);
    });
}

module.exports = {
    sanitizeInput,
    sanitizeObject,
    removerOperadoresMongoProfundo,
};
