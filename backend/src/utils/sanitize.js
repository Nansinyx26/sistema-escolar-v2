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
        disallowedTagsMode: 'discard' // Remove completamente a tag em vez de fazer escape
    });
};

/**
 * Função recursiva para sanitizar todos os campos string de um objeto (ex: req.body).
 * 
 * @param {Object} obj - Objeto a ser sanitizado
 */
const sanitizeObject = (obj) => {
    if (!obj || typeof obj !== 'object') return;

    Object.keys(obj).forEach(key => {
        if (typeof obj[key] === 'string') {
            obj[key] = sanitizeInput(obj[key]);
        } else if (typeof obj[key] === 'object' && obj[key] !== null) {
            sanitizeObject(obj[key]);
        }
    });
};

module.exports = {
    sanitizeInput,
    sanitizeObject
};
