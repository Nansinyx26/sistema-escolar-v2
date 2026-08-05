/**
 * Utilitário para escapar caracteres especiais de Regex.
 * Previne ataques ReDoS (Regular Expression Denial of Service)
 * ao sanitizar inputs do usuário antes de usá-los em RegExp() ou $regex.
 *
 * @param {string} str - String do usuário a ser escapada
 * @returns {string} - String segura para uso em RegExp
 */
function escapeRegex(str) {
    if (typeof str !== 'string') return '';
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

module.exports = escapeRegex;
