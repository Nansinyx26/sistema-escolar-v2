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

/** Emite para perfis específicos dentro de uma escola. */
function emitirParaPerfis(escolaId, perfis, evento, payload) {
    if (!global.io) return;
    const lista = (Array.isArray(perfis) ? perfis : [perfis]).filter(Boolean);
    if (!lista.length) return;
    if (!escolaId) {
        console.warn(`[realtime] '${evento}' descartado: escolaId ausente.`);
        return;
    }
    // Interseção escola × perfil: o socket precisa estar nas duas salas
    lista.forEach(perfil => {
        global.io.to(`escola:${escolaId}`).to(`role:${perfil}`).emit(evento, payload);
    });
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
