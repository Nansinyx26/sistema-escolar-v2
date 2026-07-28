/**
 * sessionToken.js — emissão, revogação e checagem do JWT de sessão.
 *
 * Centraliza três coisas que antes estavam espalhadas por ~10 call sites:
 *
 * 1. `jti` em TODO token emitido. Sem um identificador por token não existe
 *    revogação seletiva: o logout só conseguiria invalidar TODAS as sessões do
 *    usuário (bumping tokenVersion), derrubando os outros dispositivos dele.
 *
 * 2. Opções de cookie idênticas em toda emissão. Divergências entre o `set` e o
 *    `clear` fazem o browser ignorar a limpeza silenciosamente.
 *
 * 3. O ponto único onde o token entra na denylist (logout) e onde ela é
 *    consultada (authJWT).
 *
 * O token NUNCA vai no corpo da resposta — só no cookie HttpOnly.
 */
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const JWT_SECRET = require('./jwtConfig');

const COOKIE_NAME = 'escola_jwt';
const TTL = '8h';
const TTL_MS = 8 * 60 * 60 * 1000;

function opcoesCookie() {
    return {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'Lax'
    };
}

/**
 * Monta o payload padrão de sessão a partir do documento do usuário.
 * Só claims necessários para autorizar — nada de PII extra (CPF, telefone,
 * foto): o JWT é legível por qualquer um que o tenha em mãos.
 */
function montarPayload(usuario, extras = {}) {
    return {
        // Aceita doc do Mongoose (_id) ou objeto já normalizado (id)
        id: usuario._id || usuario.id,
        perfil: usuario.perfil,
        email: usuario.email,
        nome: usuario.nome,
        deveMudarSenha: !!usuario.deveMudarSenha,
        profileCompleted: !!usuario.profileCompleted,
        tokenVersion: usuario.tokenVersion || 0,
        jti: crypto.randomBytes(16).toString('hex'),
        ...extras
    };
}

/** Assina o token de sessão (sem tocar no cookie). */
function assinarTokenSessao(usuario, extras = {}) {
    return jwt.sign(montarPayload(usuario, extras), JWT_SECRET, { expiresIn: TTL });
}

/**
 * Assina o token E grava no cookie HttpOnly. Caminho preferido.
 * @returns {string} o token assinado
 */
function emitirTokenSessao(res, usuario, extras = {}) {
    const token = assinarTokenSessao(usuario, extras);
    res.cookie(COOKIE_NAME, token, { ...opcoesCookie(), maxAge: TTL_MS });
    return token;
}

/** Limpa o cookie de sessão com as MESMAS opções usadas na emissão. */
function limparCookieSessao(res) {
    res.clearCookie(COOKIE_NAME, opcoesCookie());
}

/**
 * Revoga um token de sessão específico (logout deste dispositivo).
 *
 * Fallback deliberado: se o token não tem `jti` (emitido por uma versão
 * anterior, ou por um cliente que assina direto), não há como revogá-lo
 * individualmente — então subimos o `tokenVersion` do usuário, que invalida
 * todas as sessões dele. Menos conveniente, mas nunca deixa um token vivo.
 *
 * @returns {Promise<{revogado: boolean, escopo: 'token'|'usuario'|'nenhum'}>}
 */
async function revogarTokenSessao(token) {
    if (!token) return { revogado: false, escopo: 'nenhum' };

    let payload;
    try {
        // `ignoreExpiration`: revogar um token já expirado é inofensivo e evita
        // que um token na fronteira da expiração escape da denylist.
        payload = jwt.verify(token, JWT_SECRET, { ignoreExpiration: true });
    } catch (e) {
        // Token inválido/forjado: não há sessão real para revogar.
        return { revogado: false, escopo: 'nenhum' };
    }

    const usuarioId = String(payload.id || payload._id || '');

    if (!payload.jti) {
        try {
            const Usuario = require('../models/Usuario');
            if (usuarioId) {
                await Usuario.updateOne({ _id: usuarioId }, { $inc: { tokenVersion: 1 } });
                return { revogado: true, escopo: 'usuario' };
            }
        } catch (e) {
            require('./logger').error('[LOGOUT] Falha ao revogar por tokenVersion', {
                err: e, usuarioId, action: 'auth.logout',
            });
        }
        return { revogado: false, escopo: 'nenhum' };
    }

    try {
        const TokenRevogado = require('../models/TokenRevogado');
        const expiraEm = payload.exp
            ? new Date(payload.exp * 1000)
            : new Date(Date.now() + TTL_MS);

        // upsert: logout repetido não estoura o índice unique.
        await TokenRevogado.updateOne(
            { jti: payload.jti },
            { $set: { jti: payload.jti, usuarioId, expiraEm }, $setOnInsert: { revogadoEm: new Date() } },
            { upsert: true }
        );
        return { revogado: true, escopo: 'token' };
    } catch (e) {
        require('./logger').error('[LOGOUT] Falha ao gravar denylist', {
            err: e, usuarioId, jti: payload.jti, action: 'auth.logout',
        });
        // Não conseguimos gravar a denylist — degrada para revogação total da
        // conta em vez de deixar o token vivo.
        try {
            const Usuario = require('../models/Usuario');
            if (usuarioId) {
                await Usuario.updateOne({ _id: usuarioId }, { $inc: { tokenVersion: 1 } });
                return { revogado: true, escopo: 'usuario' };
            }
        } catch (e2) {
            // Os DOIS caminhos de revogação falharam: o token do usuário continua
            // válido até expirar. É falha de segurança, não detalhe operacional —
            // o log anterior falava da denylist, não desta degradação.
            require('./logger').alert('LOGOUT_NAO_EFETIVADO',
                'Logout não pôde ser efetivado — token segue válido até expirar', {
                    err: e2, usuarioId, jti: payload.jti, action: 'auth.logout',
                });
        }
        return { revogado: false, escopo: 'nenhum' };
    }
}

/**
 * Consulta a denylist. Chamado pelo authJWT em toda requisição autenticada.
 *
 * Em caso de falha do banco devolve `true` (fail-closed): preferimos negar
 * acesso a aceitar um token possivelmente revogado.
 */
async function tokenEstaRevogado(payload) {
    if (!payload?.jti) return false; // token legado: coberto por tokenVersion
    try {
        const TokenRevogado = require('../models/TokenRevogado');
        const encontrado = await TokenRevogado.exists({ jti: payload.jti });
        return !!encontrado;
    } catch (e) {
        require('./logger').error('[AUTH] Falha ao consultar denylist de tokens (fail-closed)', {
            err: e, jti: payload.jti, action: 'auth.verificarRevogacao',
        });
        return true;
    }
}

module.exports = {
    COOKIE_NAME,
    TTL,
    TTL_MS,
    opcoesCookie,
    montarPayload,
    assinarTokenSessao,
    emitirTokenSessao,
    limparCookieSessao,
    revogarTokenSessao,
    tokenEstaRevogado
};
