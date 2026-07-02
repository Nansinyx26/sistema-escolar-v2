/**
 * Configuração centralizada de JWT.
 * Este módulo é o ÚNICO lugar onde o JWT_SECRET deve ser definido.
 * Todos os arquivos que precisam do segredo devem importar daqui.
 */

const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET && process.env.NODE_ENV !== 'test') {
    throw new Error('CRITICAL: JWT_SECRET não definido. O servidor não pode iniciar sem um JWT_SECRET definido por segurança.');
}

const ACTUAL_JWT_SECRET = JWT_SECRET || 'escola-secret-key-jest-fallback';

module.exports = ACTUAL_JWT_SECRET;
