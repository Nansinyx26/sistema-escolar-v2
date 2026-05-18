const crypto = require('crypto');

/**
 * Middleware de Proteção CSRF usando padrão Double Submit Cookie.
 * 
 * COMO FUNCIONA:
 * 1. O servidor gera um token CSRF aleatório e o envia como cookie (NÍO HttpOnly)
 * 2. O frontend lê esse cookie e o envia de volta no header `X-CSRF-Token`
 * 3. O servidor compara: se cookie === header, a requisição é legítima
 * 
 * POR QUE FUNCIONA:
 * - Um site malicioso pode ENVIAR cookies (via credentials), mas NÍO pode LER cookies de outro domínio
 * - Portanto, o site malicioso não consegue copiar o token do cookie para o header
 * 
 * ISENÇÕES:
 * - Rotas GET/HEAD/OPTIONS são seguras (não mudam estado)
 * - Rotas de autenticação pública (login, register, forgot-password) são isentas
 */

// Rotas públicas que não precisam de CSRF (não requerem autenticação)
const EXEMPT_ROUTES = [
    '/api/auth/login',
    '/api/auth/logout',
    '/api/auth/forgot-password',
    '/api/auth/reset-password',
    '/api/auth/first-access',
    '/api/auth/register-code',
    '/api/auth/mock-google-login',
    '/api/auth/google-login',
    '/api/auth/register-responsavel',
    '/api/ping'
];

/**
 * Middleware que define o cookie CSRF em toda resposta.
 * Este cookie pode ser lido pelo JavaScript do frontend (não é HttpOnly).
 */
function csrfCookieSetter(req, res, next) {
    // Se já existe um token CSRF no cookie, não regenerar (manter estável por sessão)
    if (!req.cookies.csrf_token) {
        const token = crypto.randomBytes(32).toString('hex');
        res.cookie('csrf_token', token, {
            httpOnly: false,    // Frontend PRECISA ler este cookie
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'Strict',
            maxAge: 8 * 60 * 60 * 1000 // 8h (mesmo tempo do JWT)
        });
    }
    next();
}

/**
 * Middleware que valida o token CSRF em requisições que mudam estado (POST, PUT, DELETE).
 */
function csrfValidator(req, res, next) {
    // Métodos seguros (idempotentes) não precisam de validação CSRF
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
        return next();
    }

    // Rotas isentas (públicas)
    const path = req.path || req.url;
    if (EXEMPT_ROUTES.some(route => path.startsWith(route.replace('/api', '')))) {
        return next();
    }

    // ── Bypass em testes e desenvolvimento local ─────────────────────────────
    // Em testes Jest e no desenvolvimento local (cross-origin Vite), 
    // desabilitamos a validação CSRF para permitir a comunicação local.
    // A proteção permanece 100% ativa em ambiente de Produção.
    if (process.env.NODE_ENV !== 'production') {
        return next();
    }

    // Compara: cookie CSRF === header CSRF
    const cookieToken = req.cookies.csrf_token;
    const headerToken = req.headers['x-csrf-token'];

    if (!cookieToken || !headerToken || cookieToken !== headerToken) {
        console.warn(`⚠️ [CSRF] Bloqueado: ${req.method} ${path} | Cookie: ${cookieToken ? 'presente' : 'ausente'} | Header: ${headerToken ? 'presente' : 'ausente'}`);
        return res.status(403).json({
            success: false,
            error: 'Requisição bloqueada por proteção CSRF. Recarregue a página e tente novamente.'
        });
    }

    next();
}

module.exports = { csrfCookieSetter, csrfValidator };
