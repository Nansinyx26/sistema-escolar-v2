/**
 * escolaBloqueio.js — bloqueio administrativo de escola (Issue #463).
 *
 * Ponto único que responde "esta escola está bloqueada?" e "esta conta passa
 * por cima do bloqueio?". Quem consulta:
 *
 *   • `UserController.login` e `googleLogin` — recusam a entrada com a
 *     mensagem clara, antes de emitir sessão ou pré-auth do 2FA;
 *   • `middleware/authJWT`        — derruba a sessão já aberta no próximo request;
 *   • `middleware/filtrarPorEscola` — cobre a escola resolvida por vínculo, que
 *     o authJWT ainda não conhece;
 *   • o `io.use` do Socket.IO (src/index.js) — recusa reconexão.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POR QUE UM CACHE DO CONJUNTO, E NÃO UMA QUERY POR REQUEST
 * ─────────────────────────────────────────────────────────────────────────
 * O authJWT roda em TODA requisição autenticada. Bloqueio é raro: guardar o
 * conjunto das bloqueadas (quase sempre vazio) custa uma query a cada
 * `TTL_MS` por instância, não uma por request.
 *
 * O TTL é curto de propósito: é ele que faz o bloqueio e o desbloqueio valerem
 * nas OUTRAS instâncias sem reinício. Na instância que atendeu o PATCH o efeito
 * é imediato — o controller chama `invalidarCache()`.
 *
 * Falha do banco mantém o último conjunto conhecido (não abre nem fecha tudo):
 * abrir soltaria uma escola bloqueada; fechar trancaria a rede inteira por uma
 * oscilação de conexão — e o resto da requisição falharia de qualquer jeito.
 */
const Escola = require('../models/Escola');
const logger = require('../utils/logger');
const { revogarTokenSessao, limparCookieSessao } = require('../utils/sessionToken');

const CODIGO = 'ESCOLA_BLOQUEADA';
const MENSAGEM = 'Escola temporariamente bloqueada. Contate o administrador.';
const EVENTO_SOCKET = 'escola:bloqueada';

const TTL_MS = Number(process.env.ESCOLA_BLOQUEIO_CACHE_MS) || 5000;

let cache = { em: 0, ids: new Set() };
let emAndamento = null;

async function recarregar() {
    try {
        const bloqueadas = await Escola.find({ status: 'bloqueada' }).select('_id').lean();
        cache = { em: Date.now(), ids: new Set(bloqueadas.map((e) => String(e._id))) };
    } catch (err) {
        logger.error('[escolaBloqueio] não foi possível ler as escolas bloqueadas', {
            err,
            action: 'escola.bloqueio.cache',
        });
        // Mantém o conjunto anterior; tenta de novo no próximo TTL.
        cache = { em: Date.now(), ids: cache.ids };
    }
    return cache.ids;
}

/** Conjunto (Set de strings) das escolas bloqueadas, com cache de `TTL_MS`. */
async function escolasBloqueadas() {
    if (Date.now() - cache.em < TTL_MS) return cache.ids;
    if (!emAndamento) {
        emAndamento = recarregar().finally(() => {
            emAndamento = null;
        });
    }
    return emAndamento;
}

/** Descarta o cache desta instância — chamado depois de bloquear/desbloquear. */
function invalidarCache() {
    cache = { em: 0, ids: cache.ids };
}

/**
 * Super admin = `perfil: 'admin'` E `superAdmin: true`, ambos lidos do BANCO.
 * O admin comum não passa: é justamente ele (e toda a equipe) que o bloqueio
 * alcança quando a conta pertence à escola bloqueada.
 */
function ehSuperAdmin(usuario) {
    return !!usuario && usuario.perfil === 'admin' && usuario.superAdmin === true;
}

/**
 * A conta deve ser barrada? Recebe a lista de escolas que a requisição/sessão
 * envolve (ids possivelmente vazios) e devolve o id da primeira bloqueada, ou
 * `null`. Super admin nunca é barrado.
 */
async function escolaBloqueadaPara(usuario, escolaIds) {
    if (ehSuperAdmin(usuario)) return null;
    const candidatos = (escolaIds || []).filter(Boolean).map(String);
    if (!candidatos.length) return null;
    const ids = await escolasBloqueadas();
    return candidatos.find((id) => ids.has(id)) || null;
}

/** Corpo padronizado da recusa — o front reage a `codigo`, nunca ao texto. */
function respostaBloqueio() {
    return { success: false, ok: false, codigo: CODIGO, error: MENSAGEM };
}

function tokenDaRequisicao(req) {
    if (req.cookies?.escola_jwt) return req.cookies.escola_jwt;
    const auth = req.headers?.authorization || '';
    return auth.startsWith('Bearer ') ? auth.slice(7) : null;
}

/**
 * Encerra a sessão de quem está numa escola bloqueada e responde a recusa.
 *
 * "Invalidar no próximo request" é literal: o token entra na denylist (o mesmo
 * caminho do logout) e o cookie é apagado. Desbloqueada a escola, a pessoa
 * entra de novo pelo login — não há sessão velha ressuscitando sozinha.
 */
async function recusarSessaoBloqueada(req, res, escolaId) {
    logger.warn('[escolaBloqueio] sessão encerrada: escola bloqueada', {
        escolaId: String(escolaId),
        perfil: req.user?.perfil,
        action: 'escola.bloqueio.sessao',
    });
    try {
        await revogarTokenSessao(tokenDaRequisicao(req));
    } catch (_e) {
        // revogarTokenSessao já registra as próprias falhas.
    }
    limparCookieSessao(res);
    if (req.session) req.session.escolaAtivaId = undefined;
    return res.status(403).json(respostaBloqueio());
}

/**
 * Avisa e desconecta quem está online na escola. Vale em todas as instâncias:
 * `fetchSockets()` atravessa o adapter compartilhado quando ele está instalado.
 *
 * O super admin que estiver na sala (contexto de visualização) fica conectado.
 *
 * @returns {Promise<number>} quantos sockets foram desconectados
 */
async function desconectarEscola(io, escolaId) {
    if (!io || !escolaId) return 0;
    const sala = `escola:${String(escolaId)}`;
    let desconectados = 0;
    try {
        const sockets = await io.in(sala).fetchSockets();
        for (const socket of sockets) {
            if (ehSuperAdmin(socket.data?.usuario)) continue;
            socket.emit(EVENTO_SOCKET, { codigo: CODIGO, mensagem: MENSAGEM });
            socket.disconnect(true);
            desconectados++;
        }
    } catch (err) {
        logger.error('[escolaBloqueio] falha ao desconectar os sockets da escola', {
            err,
            escolaId: String(escolaId),
            action: 'escola.bloqueio.socket',
        });
    }
    return desconectados;
}

module.exports = {
    CODIGO,
    escolaBloqueadaPara,
    invalidarCache,
    ehSuperAdmin,
    respostaBloqueio,
    recusarSessaoBloqueada,
    desconectarEscola,
};
