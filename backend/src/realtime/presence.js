/**
 * realtime/presence.js
 * Presença online em memória (por escola), alimentada pelo socket.io.
 *
 * Estrutura: escolaId -> Map<userId, registro>. O `conexoes` cobre múltiplas
 * abas/dispositivos do mesmo usuário: só fica offline quando o último socket
 * cai. É intencionalmente em memória (não persiste) — presença é efêmera e
 * some quando o processo reinicia, que é o comportamento correto.
 *
 * Cada registro guarda:
 *   conexoes  — refCount de sockets abertos;
 *   desde     — quando a primeira conexão entrou (base do "tempo online");
 *   ausente   — Set de socketIds ociosos; o usuário só é "ausente" quando
 *               TODAS as suas abas estão ociosas (aba ativa em outro monitor
 *               continua valendo como online).
 *
 * `lastSeen` fica num mapa separado (userId -> Date), preservado após o
 * disconnect para alimentar o "visto por último" do cabeçalho da conversa.
 *
 * VÁRIAS INSTÂNCIAS (Issue #339)
 * ------------------------------
 * O mapa acima só conhece os sockets conectados NESTE processo. Com o adapter
 * compartilhado ligado (SOCKET_ADAPTER=mongo, ver realtime/adapter.js), quem
 * precisa saber a presença de verdade usa `consultar()`: ela pergunta ao
 * adapter (`fetchSockets`), que responde com os sockets de todas as
 * instâncias, e monta o status a partir do `socket.data.presenca` de cada um.
 * Com uma instância só, `consultar()` lê o mapa em memória, sem ida ao banco.
 */

const logger = require('../utils/logger');

const byEscola = new Map(); // escolaId(String) -> Map<userId(String), registro>
const lastSeen = new Map(); // userId(String) -> Date

const k = (v) => String(v);

function registro(escolaId, userId) {
    const m = byEscola.get(k(escolaId));
    return m ? m.get(k(userId)) : undefined;
}

/**
 * Marca um usuário como conectado. Retorna true se ele passou de offline
 * para online agora (primeira conexão), para o chamador emitir o evento.
 */
function addUser(escolaId, userId, socketId) {
    if (!escolaId || !userId) return false;
    const e = k(escolaId);
    const u = k(userId);
    let m = byEscola.get(e);
    if (!m) {
        m = new Map();
        byEscola.set(e, m);
    }

    const atual = m.get(u);
    if (atual) {
        atual.conexoes += 1;
        // Aba nova nasce ativa: um usuário marcado como ausente volta a online.
        if (socketId) atual.ausente.delete(k(socketId));
        return false;
    }

    m.set(u, { conexoes: 1, desde: new Date(), ausente: new Set() });
    lastSeen.set(u, new Date());
    return true;
}

/**
 * Remove uma conexão do usuário. Retorna true se ele ficou offline agora
 * (última conexão encerrada).
 */
function removeUser(escolaId, userId, socketId) {
    if (!escolaId || !userId) return false;
    const e = k(escolaId);
    const u = k(userId);
    const m = byEscola.get(e);
    if (!m || !m.has(u)) return false;

    const reg = m.get(u);
    if (socketId) reg.ausente.delete(k(socketId));
    reg.conexoes -= 1;

    if (reg.conexoes <= 0) {
        m.delete(u);
        if (m.size === 0) byEscola.delete(e);
        lastSeen.set(u, new Date());
        return true;
    }
    return false;
}

/**
 * Marca/desmarca uma aba como ociosa. Retorna true se o status agregado do
 * usuário mudou (online <-> ausente), para o chamador emitir o evento.
 */
function setAusente(escolaId, userId, socketId, ausente) {
    const reg = registro(escolaId, userId);
    if (!reg || !socketId) return false;

    const antes = reg.ausente.size >= reg.conexoes;
    if (ausente) reg.ausente.add(k(socketId));
    else reg.ausente.delete(k(socketId));
    const depois = reg.ausente.size >= reg.conexoes;

    if (!ausente) lastSeen.set(k(userId), new Date());
    return antes !== depois;
}

/** IDs de usuário online numa escola. */
function onlineUserIds(escolaId) {
    const m = byEscola.get(k(escolaId));
    return m ? [...m.keys()] : [];
}

/** true se o usuário tem ao menos uma conexão aberta na escola. */
function isOnline(escolaId, userId) {
    return !!registro(escolaId, userId);
}

/**
 * Status agregado: 'online' | 'ausente' | 'offline'.
 * Fonte única para o card de usuários e para o cabeçalho da conversa.
 */
function statusDe(escolaId, userId) {
    const reg = registro(escolaId, userId);
    if (!reg) return 'offline';
    return reg.ausente.size >= reg.conexoes ? 'ausente' : 'online';
}

/** Momento em que o usuário ficou online (Date) ou null se offline. */
function onlineDesde(escolaId, userId) {
    const reg = registro(escolaId, userId);
    return reg ? reg.desde : null;
}

/** Última atividade conhecida (Date) ou null — sobrevive ao disconnect. */
function ultimoAcesso(userId) {
    return lastSeen.get(k(userId)) || null;
}

/** Resumo completo, usado pelas rotas que montam a lista da equipe. */
function infoDe(escolaId, userId) {
    const status = statusDe(escolaId, userId);
    return {
        status,
        online: status !== 'offline',
        onlineDesde: onlineDesde(escolaId, userId),
        ultimoAcesso: ultimoAcesso(userId),
    };
}

// ── Presença entre instâncias ────────────────────────────────────────────────

let ioCompartilhado = null; // servidor Socket.IO com adapter compartilhado

// Cache curto do "está online?" usado pelo "digitando": o evento dispara a
// cada tecla, e cada consulta ao adapter é uma ida ao banco.
const TTL_ONLINE_MS = 10000;
const TTL_OFFLINE_MS = 3000;
const LIMITE_CACHE = 2000;
const cacheOnline = new Map(); // `${escolaId}|${userId}` -> { online, expira }

/** Liga (ou desliga, com null) a consulta pelo adapter compartilhado. */
function usarAdapter(io) {
    ioCompartilhado = io || null;
    cacheOnline.clear();
}

/**
 * Grava no `socket.data` o que as outras instâncias precisam para calcular a
 * presença. Só dados simples: o adapter serializa isto para o banco.
 */
function marcarSocket(socket, escolaId, userId) {
    const agora = Date.now();
    socket.data.presenca = {
        escolaId: k(escolaId),
        userId: k(userId),
        desde: agora,
        vistoEm: agora,
        ausente: false,
    };
}

/** Atualiza o estado de ociosidade da aba no `socket.data`. */
function marcarAusenteNoSocket(socket, ausente) {
    const dados = socket.data && socket.data.presenca;
    if (!dados) return;
    dados.ausente = !!ausente;
    if (!ausente) dados.vistoEm = Date.now();
}

/** Agrupa os sockets por usuário: userId -> { conexoes, ausentes, desde, vistoEm }. */
function agregar(dadosDosSockets) {
    const porUsuario = new Map();
    for (const d of dadosDosSockets) {
        const atual = porUsuario.get(d.userId) || {
            conexoes: 0,
            ausentes: 0,
            desde: Infinity,
            vistoEm: 0,
        };
        atual.conexoes += 1;
        if (d.ausente) atual.ausentes += 1;
        atual.desde = Math.min(atual.desde, Number(d.desde) || Date.now());
        atual.vistoEm = Math.max(atual.vistoEm, Number(d.vistoEm) || 0);
        porUsuario.set(d.userId, atual);
    }
    return porUsuario;
}

/** Retrato lido do mapa deste processo — o comportamento de uma instância só. */
function retratoLocal(escolaId) {
    return {
        onlineUserIds: () => onlineUserIds(escolaId),
        isOnline: (userId) => isOnline(escolaId, userId),
        statusDe: (userId) => statusDe(escolaId, userId),
        infoDe: (userId) => infoDe(escolaId, userId),
    };
}

/** Retrato montado a partir dos sockets de todas as instâncias. */
function retratoCompartilhado(porUsuario) {
    const statusDoRegistro = (reg) => {
        if (!reg) return 'offline';
        return reg.ausentes >= reg.conexoes ? 'ausente' : 'online';
    };
    return {
        onlineUserIds: () => [...porUsuario.keys()],
        isOnline: (userId) => porUsuario.has(k(userId)),
        statusDe: (userId) => statusDoRegistro(porUsuario.get(k(userId))),
        infoDe: (userId) => {
            const reg = porUsuario.get(k(userId));
            const status = statusDoRegistro(reg);
            // O "visto por último" de quem saiu fica só na instância em que ele
            // estava; de quem está conectado, vem do próprio socket.
            const local = ultimoAcesso(userId);
            const visto = Math.max(reg ? reg.vistoEm : 0, local ? local.getTime() : 0);
            return {
                status,
                online: status !== 'offline',
                onlineDesde: reg ? new Date(reg.desde) : null,
                ultimoAcesso: visto ? new Date(visto) : null,
            };
        },
    };
}

/**
 * Presença de uma escola vista por todas as instâncias. Com `userId`, consulta
 * só a sala daquele usuário, que é mais barato que a sala da escola inteira.
 *
 * Devolve um retrato com `onlineUserIds()`, `isOnline(id)`, `statusDe(id)` e
 * `infoDe(id)`, nos mesmos formatos das funções síncronas deste módulo. Nunca
 * lança: se o adapter não responder, cai no mapa deste processo.
 */
async function consultar(escolaId, userId) {
    if (!ioCompartilhado || !escolaId) return retratoLocal(escolaId);

    const escola = k(escolaId);
    const sala = userId ? `user:${k(userId)}` : `escola:${escola}`;
    try {
        const sockets = await ioCompartilhado.in(sala).fetchSockets();
        const dados = sockets
            .map((s) => s.data && s.data.presenca)
            .filter((d) => d && d.userId && d.escolaId === escola);
        return retratoCompartilhado(agregar(dados));
    } catch (err) {
        logger.warn(
            `[presence] Adapter não respondeu à consulta de presença: ${err.message}. Usando só esta instância.`
        );
        return retratoLocal(escolaId);
    }
}

/**
 * true se o usuário tem conexão aberta na escola, em qualquer instância.
 * Usado a cada evento de "digitando", por isso guarda a resposta por alguns
 * segundos.
 */
async function estaOnline(escolaId, userId) {
    if (!escolaId || !userId) return false;
    if (isOnline(escolaId, userId)) return true;
    if (!ioCompartilhado) return false;

    const chave = `${k(escolaId)}|${k(userId)}`;
    const guardado = cacheOnline.get(chave);
    if (guardado && guardado.expira > Date.now()) return guardado.online;

    const online = (await consultar(escolaId, userId)).isOnline(userId);
    if (cacheOnline.size >= LIMITE_CACHE) cacheOnline.clear();
    cacheOnline.set(chave, {
        online,
        expira: Date.now() + (online ? TTL_ONLINE_MS : TTL_OFFLINE_MS),
    });
    return online;
}

module.exports = {
    addUser,
    removeUser,
    setAusente,
    onlineUserIds,
    isOnline,
    statusDe,
    onlineDesde,
    ultimoAcesso,
    infoDe,
    usarAdapter,
    marcarSocket,
    marcarAusenteNoSocket,
    consultar,
    estaOnline,
};
