/**
 * acessoAMensagem.js — autoriza a entrada numa sala `message:<id>`.
 *
 * A sala carrega comentários e reações (nome e perfil de quem reagiu, nome do
 * aluno) de um comunicado ou de uma notificação. O usuário só entra se o
 * documento for da escola dele e endereçado a ele.
 *
 * Saiu de index.js (Issue #687) para poder ser testado sem subir o servidor, e
 * passou a:
 * - recusar a equipe sem escola resolvida no socket (0 ou 2+ vínculos e sem
 *   escola na conta) em documento de escola a que a conta não pertence. A
 *   fronteira era `socket.escolaId && …` e era pulada nesse caso; o HTTP
 *   recusa (#396);
 * - exigir do responsável filho vinculado na escola do documento para os
 *   públicos `todos` e `responsaveis`.
 */
const mongoose = require('mongoose');
const Comunicado = require('../models/Comunicado');
const Notificacao = require('../models/Notificacao');
const { vinculosDoUsuario } = require('../middleware/filtrarPorEscola');
const { alvosDoUsuario } = require('../services/vinculoDoResponsavel');

/** true se a conta da equipe pertence à escola (vínculo ou cadastro). */
async function equipeDaEscola(socket, perfil, escolaId) {
    const user = socket.user || {};
    const vinculos = await vinculosDoUsuario({
        id: user.id || user._id,
        email: user.email,
        perfil,
    });
    return vinculos.some((v) => String(v.escolaId) === String(escolaId));
}

async function podeAcessarMensagem(socket, messageId) {
    const perfil = String(socket.user?.perfil || '').toLowerCase();
    if (perfil === 'admin') return true;

    const filtroId = mongoose.Types.ObjectId.isValid(messageId)
        ? { $or: [{ _id: messageId }, { id: messageId }] }
        : { id: messageId };

    const doc =
        (await Comunicado.findOne(filtroId).select('escolaId destinatarios').lean()) ||
        (await Notificacao.findOne(filtroId)
            .select('escolaId destinatarios paraResponsavel')
            .lean());

    if (!doc) return false;

    // Fronteira de escola
    if (doc.escolaId) {
        if (socket.escolaId) {
            if (String(doc.escolaId) !== String(socket.escolaId)) return false;
        } else if (perfil !== 'responsavel') {
            if (!(await equipeDaEscola(socket, perfil, doc.escolaId))) return false;
        }
        // Responsável sem escola no socket: decidido abaixo pelo filho
        // vinculado na escola do documento.
    }

    // Gestão acompanha qualquer mensagem da própria escola
    if (['diretor', 'secretaria'].includes(perfil)) return true;

    // Responsável nunca entra em sala de aviso interno de funcionários
    if (perfil === 'responsavel' && doc.paraResponsavel === false) return false;

    const destinatarios = Array.isArray(doc.destinatarios)
        ? doc.destinatarios
        : [doc.destinatarios].filter(Boolean);
    const alvos = await alvosDoUsuario(socket.user, doc.escolaId);
    return destinatarios.some((d) => alvos.includes(String(d)));
}

module.exports = { podeAcessarMensagem };
