/**
 * preAuthToken.js — prova de que a etapa de SENHA foi concluída.
 *
 * O fluxo 2FA antigo aceitava apenas { userId, codigo }. Como o _id de um
 * diretor vaza em /api/usuarios, /api/comunicados e no campo `criadoPor` das
 * notificações, dava para forçar bruta os 10^6 códigos direto no /2fa/verify
 * SEM NUNCA conhecer a senha — e o cookie de diretor saía no fim.
 *
 * Agora o passo de senha emite um JWT curto (5 min), de propósito distinto
 * ('pre-auth'), que é o único jeito de chegar ao /2fa/send e ao /2fa/verify.
 */
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const JWT_SECRET = require('./jwtConfig');

const PRE_AUTH_TTL_SEGUNDOS = 5 * 60;
const COOKIE_NAME = 'escola_preauth';

/**
 * Emite o token de pré-autenticação e o grava em cookie HttpOnly.
 * @returns {string} o token (também devolvido no corpo para clientes não-browser)
 */
function emitirPreAuthToken(res, usuario, extras = {}) {
    const token = jwt.sign(
        {
            sub: String(usuario._id),
            purpose: 'pre-auth',
            jti: crypto.randomBytes(12).toString('hex'),
            ...extras,
        },
        JWT_SECRET,
        { expiresIn: PRE_AUTH_TTL_SEGUNDOS }
    );

    res.cookie(COOKIE_NAME, token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'Lax',
        maxAge: PRE_AUTH_TTL_SEGUNDOS * 1000,
    });

    return token;
}

/**
 * Valida o token de pré-autenticação vindo do cookie ou do corpo.
 * @returns {{ok: true, userId: string, payload: Object} | {ok: false, error: string}}
 */
function validarPreAuthToken(req) {
    const token = req.cookies?.[COOKIE_NAME] || req.body?.preAuthToken;
    if (!token) {
        return { ok: false, error: 'Sessão de verificação expirada. Faça login novamente.' };
    }
    try {
        const payload = jwt.verify(token, JWT_SECRET);
        if (payload.purpose !== 'pre-auth' || !payload.sub) {
            return { ok: false, error: 'Token de verificação inválido.' };
        }
        return { ok: true, userId: String(payload.sub), payload };
    } catch (e) {
        return { ok: false, error: 'Sessão de verificação expirada. Faça login novamente.' };
    }
}

/** Limpa o cookie de pré-autenticação (após sucesso ou logout). */
function limparPreAuthToken(res) {
    res.clearCookie(COOKIE_NAME, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'Lax',
    });
}

module.exports = {
    emitirPreAuthToken,
    validarPreAuthToken,
    limparPreAuthToken,
    PRE_AUTH_TTL_SEGUNDOS,
    COOKIE_NAME,
};
