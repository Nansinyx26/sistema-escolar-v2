/**
 * Configuração centralizada de JWT.
 * Este módulo é o ÚNICO lugar onde o JWT_SECRET deve ser definido.
 * Todos os arquivos que precisam do segredo devem importar daqui.
 */

const JWT_SECRET = process.env.JWT_SECRET;

// Em produção, o JWT_SECRET é OBRIGATÓRIO
if (!JWT_SECRET && process.env.NODE_ENV === 'production') {
    throw new Error('CRITICAL: JWT_SECRET não definido. O servidor não pode iniciar em modo de produção por segurança.');
}

// Em desenvolvimento, usa um fallback (apenas para conveniência local)
const ACTUAL_JWT_SECRET = JWT_SECRET || 'escola-secret-key-dev-only';

module.exports = ACTUAL_JWT_SECRET;
