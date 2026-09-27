/**
 * realtime.js — emissão de eventos Socket.IO com escopo.
 *
 * `global.io.emit(...)` entrega o evento a TODOS os sockets conectados,
 * sem filtro de escola nem de perfil: comunicados internos, nomes de alunos
 * recém-vinculados e cadastros novos vazavam para qualquer usuário logado,
 * inclusive de outras escolas. Todo emissor deve usar um dos helpers abaixo.
 *
 * Salas criadas no handshake (backend/src/index.js):
 *   user:<id>        — sessão individual
 *   role:<perfil>    — todos daquele perfil
 *   escola:<id>      — todos daquela escola
 *   message:<id>     — participantes de um comunicado/notificação
 */

/** Emite para uma escola inteira (todos os perfis daquela escola). */
function emitirParaEscola(escolaId, evento, payload) {
    if (!global.io) return;
    if (!escolaId) {
        // Sem escola resolvida não há como restringir — o evento é descartado
        // em vez de virar broadcast global.
        console.warn(`[realtime] '${evento}' descartado: escolaId ausente.`);
        return;
    }
    global.io.to(`escola:${escolaId}`).emit(evento, payload);
}

/**
 * Emite para perfis específicos DENTRO de uma escola.
 *
 * `io.to(escola).to(perfil)` no Socket.IO é UNIÃO, não interseção: a versão
 * anterior entregava o evento a todo mundo da escola (responsáveis incluídos)
 * e ao perfil de todas as escolas da rede. A interseção é feita aqui, socket
 * a socket — `fetchSockets` também responde pelos sockets das outras
 * instâncias pelo adapter compartilhado (ver realtime/adapter.js).
 *
 * Quem chama não precisa aguardar: a promessa nunca rejeita.
 *
 * @returns {Promise<number>} quantos sockets receberam o evento.
 */
async function emitirParaPerfis(escolaId, perfis, evento, payload) {
    if (!global.io) return 0;
    const lista = (Array.isArray(perfis) ? perfis : [perfis]).filter(Boolean);
    if (!lista.length) return 0;
    if (!escolaId) {
        console.warn(`[realtime] '${evento}' descartado: escolaId ausente.`);
        return 0;
    }

    const salas = lista.map((perfil) => `role:${perfil}`);
    try {
        const sockets = await global.io.in(`escola:${escolaId}`).fetchSockets();
        let entregues = 0;
        for (const s of sockets) {
            const rooms = s.rooms instanceof Set ? s.rooms : new Set(s.rooms || []);
            if (salas.some((r) => rooms.has(r))) {
                s.emit(evento, payload);
                entregues++;
            }
        }
        return entregues;
    } catch (err) {
        // O evento é aviso de tela; a ação que o originou já aconteceu e não
        // pode falhar por causa dele.
        console.warn(`[realtime] '${evento}' não entregue: ${err.message}`);
        return 0;
    }
}

/** Emite para um usuário específico. */
function emitirParaUsuario(usuarioId, evento, payload) {
    if (!global.io || !usuarioId) return;
    global.io.to(`user:${usuarioId}`).emit(evento, payload);
}

/** Emite para a sala de uma mensagem/comunicado (reações, comentários). */
function emitirParaMensagem(messageId, evento, payload) {
    if (!global.io || !messageId) return;
    global.io.to(`message:${messageId}`).emit(evento, payload);
}

module.exports = {
    emitirParaEscola,
    emitirParaPerfis,
    emitirParaUsuario,
    emitirParaMensagem,
};
