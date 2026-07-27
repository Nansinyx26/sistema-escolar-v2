const Comentario = require('../models/Comentario');
const Comunicado = require('../models/Comunicado');
const Usuario = require('../models/Usuario');
const NotificationService = require('../services/NotificationService');
const logger = require('../utils/logger');
const mongoose = require('mongoose');
const { emitirParaMensagem } = require('../utils/realtime');

/**
 * ACESSO À THREAD (comunicado ou notificação).
 *
 * As rotas de comentário recebiam só o id da mensagem e devolviam/aceitavam
 * comentários sem verificar NADA além de estar autenticado: qualquer conta lia
 * a thread de qualquer comunicado — inclusive de outra escola, e inclusive de
 * comunicados internos endereçados só à direção — bastando o `_id`, que vaza em
 * listagem, notificação e no payload do Socket.IO.
 *
 * A regra de quem enxerga a thread é a MESMA de quem enxerga a mensagem, então
 * ela é importada do ComunicadoController em vez de reescrita aqui.
 *
 * @returns {Promise<{ok: true} | {ok: false, status: number, error: string}>}
 */
async function assertAcessoAThread(req, { comunicadoId, notificacaoId }) {
    const perfil = String(req.user?.perfil || '').toLowerCase();

    if (comunicadoId) {
        const { podeVerComunicado, escopoEscola } = require('./ComunicadoController');

        const comunicado = await Comunicado.findOne(
            escopoEscola(req, { _id: String(comunicadoId), ativo: true })
        ).lean().catch(() => null);

        // 404 (e não 403) quando o comunicado é de outra escola: distinguir os
        // dois casos confirmaria a existência do id no outro tenant.
        if (!comunicado) {
            return { ok: false, status: 404, error: 'Comunicado não encontrado.' };
        }
        if (!(await podeVerComunicado(comunicado, req.user))) {
            return { ok: false, status: 403, error: 'Você não tem acesso a este comunicado.' };
        }
        return { ok: true };
    }

    if (notificacaoId) {
        const Notificacao = require('../models/Notificacao');
        const notificacao = await Notificacao.findOne(buildNotifQuery(notificacaoId)).lean().catch(() => null);
        if (!notificacao) {
            return { ok: false, status: 404, error: 'Notificação não encontrada.' };
        }

        // Notificação não tem a regra de destinatários modelada como o
        // comunicado (o campo é Mixed e cada emissor grava num formato). O que
        // dá para impor com segurança aqui é a fronteira de tenant, que é
        // justamente o que faltava. Admin é global por definição.
        if (perfil !== 'admin' && req.escolaId && notificacao.escolaId
            && String(notificacao.escolaId) !== String(req.escolaId)) {
            return { ok: false, status: 404, error: 'Notificação não encontrada.' };
        }
        return { ok: true };
    }

    return { ok: false, status: 400, error: 'Informe o comunicado ou a notificação.' };
}

/** Filtro que casa a notificação por _id (quando ObjectId) ou pelo `id` textual. */
function buildNotifQuery(notificacaoId) {
    const valor = String(notificacaoId);
    return mongoose.Types.ObjectId.isValid(valor)
        ? { $or: [{ _id: valor }, { id: valor }] }
        : { id: valor };
}

exports.add = async (req, res) => {
    try {
        const { comunicadoId, notificacaoId, texto, audioUrl, parentId } = req.body;
        const usuarioId = req.user.id || req.user._id;
 
        if ((!comunicadoId && !notificacaoId) || (!texto && !audioUrl)) {
            return res.status(400).json({ success: false, error: 'ID (comunicado ou notificação) e conteúdo (texto ou áudio) são obrigatórios.' });
        }

        // Só comenta quem enxerga a mensagem. Sem isto, qualquer autenticado
        // injetava comentário na thread de qualquer comunicado da rede.
        const acesso = await assertAcessoAThread(req, { comunicadoId, notificacaoId });
        if (!acesso.ok) {
            return res.status(acesso.status).json({ success: false, error: acesso.error });
        }

        const usuario = await Usuario.findById(usuarioId).lean();
        if (!usuario) {
            return res.status(404).json({ success: false, error: 'Usuário não encontrado.' });
        }
 
        const novoComentario = new Comentario({
            comunicadoId: comunicadoId || null,
            notificacaoId: notificacaoId || null,
            usuarioId,
            usuarioNome: usuario.nome,
            usuarioFoto: usuario.foto || usuario.fotoGoogle || '',
            usuarioPerfil: usuario.perfil,
            texto,
            audioUrl,
            parentId: parentId || null
        });
 
        await novoComentario.save();
 
        // Incrementa contagem no comunicado se existir
        let comunicado = null;
        if (comunicadoId) {
            comunicado = await Comunicado.findByIdAndUpdate(comunicadoId, { $inc: { comentariosCount: 1 } });
        }

        // Incrementa contagem na notificação se existir
        if (notificacaoId) {
            const Notificacao = require('../models/Notificacao');
            const mongoose = require('mongoose');
            const filter = mongoose.Types.ObjectId.isValid(notificacaoId)
                ? { $or: [{ _id: notificacaoId }, { id: notificacaoId }] }
                : { id: notificacaoId };
            await Notificacao.findOneAndUpdate(
                filter,
                { $inc: { comentariosCount: 1 } }
            );
        }
 
        // --- NOTIFICAÇÕES ---
        try {
            if (parentId) {
                // Notificar autor do comentário original
                const originalComment = await Comentario.findById(parentId).lean();
                if (originalComment && originalComment.usuarioId.toString() !== usuarioId.toString()) {
                    await NotificationService.notify({
                        tipo: 'informativo',
                        categoria: 'chat',
                        titulo: 'Nova resposta',
                        mensagem: `${usuario.nome} respondeu seu comentário.`,
                        destinatarios: `usuario:${originalComment.usuarioId}`,
                        criadoPor: usuarioId,
                        link: '/dashboard'
                    });
                }
            } else if (comunicado) {
                // Notificar diretores sobre novo comentário no post
                await NotificationService.notify({
                    tipo: 'informativo',
                    categoria: 'comunicado',
                    titulo: 'Novo comentário em comunicado',
                    mensagem: `${usuario.nome} comentou na publicação "${comunicado.titulo}".`,
                    destinatarios: 'diretor',
                    criadoPor: usuarioId,
                    link: '/dashboard'
                });
            }
        } catch (notifErr) {
            logger.error(`Erro ao processar notificações de post: ${notifErr.message}`);
        }
 
        // Emitir evento em tempo real — apenas na sala da mensagem.
        // O emit global mandava o comentário para todos os sockets da rede,
        // inclusive de outras escolas.
        emitirParaMensagem(comunicadoId || notificacaoId, 'comentario:new', {
            comunicadoId: comunicadoId || null,
            notificacaoId: notificacaoId || null,
            comentario: novoComentario
        });
 
        res.status(201).json({ success: true, data: novoComentario });
    } catch (error) {
        logger.error(`Error adding comentario: ${error.message}`);
        res.status(500).json({ success: false, error: error.message });
    }
};

exports.update = async (req, res) => {
    try {
        const { texto } = req.body;
        const usuarioId = req.user.id || req.user._id;

        const comentario = await Comentario.findById(req.params.id);
        if (!comentario) return res.status(404).json({ success: false, error: 'Não encontrado.' });

        // Apenas o autor pode editar
        if (comentario.usuarioId.toString() !== usuarioId.toString()) {
            return res.status(403).json({ success: false, error: 'Não autorizado.' });
        }

        comentario.texto = texto;
        comentario.dataAtualizacao = Date.now();
        await comentario.save();

        emitirParaMensagem(
            comentario.comunicadoId || comentario.notificacaoId,
            'comentario:update',
            { comentario }
        );

        res.json({ success: true, data: comentario });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};

exports.getByComunicado = async (req, res) => {
    try {
        const { comunicadoId } = req.params;

        const acesso = await assertAcessoAThread(req, { comunicadoId });
        if (!acesso.ok) {
            return res.status(acesso.status).json({ success: false, error: acesso.error });
        }

        // Busca robusta: tenta por ObjectId e por string para cobrir ambos os casos
        const queries = [{ comunicadoId, ativo: true }];
        if (mongoose.Types.ObjectId.isValid(comunicadoId)) {
            queries.push({ comunicadoId: new mongoose.Types.ObjectId(comunicadoId), ativo: true });
        }
        // Também tenta como string pura caso o campo tenha sido salvo como string
        queries.push({ comunicadoId: comunicadoId.toString(), ativo: true });
        
        let comentarios = await Comentario.find({ $or: queries })
            .populate('usuarioId', 'nome foto fotoGoogle perfil')
            .sort({ dataCriacao: 1 })
            .lean();
        
        // Deduplica caso a mesma entrada apareça em múltiplas queries
        const seen = new Set();
        comentarios = comentarios.filter(c => {
            const id = c._id.toString();
            if (seen.has(id)) return false;
            seen.add(id);
            return true;
        });
            
        comentarios = formatComments(comentarios);
        res.json({ success: true, data: comentarios });
    } catch (error) {
        logger.error(`[ComentarioController.getByComunicado] Error: ${error.message}`);
        res.status(500).json({ success: false, error: error.message });
    }
};

exports.getByNotificacao = async (req, res) => {
    try {
        const { notificacaoId } = req.params;

        const acesso = await assertAcessoAThread(req, { notificacaoId });
        if (!acesso.ok) {
            return res.status(acesso.status).json({ success: false, error: acesso.error });
        }

        let comentarios = await Comentario.find({ notificacaoId, ativo: true })
            .populate('usuarioId', 'nome foto fotoGoogle perfil')
            .sort({ dataCriacao: 1 })
            .lean();
            
        comentarios = formatComments(comentarios);
        res.json({ success: true, data: comentarios });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};

const formatComments = (comments) => {
    return comments.map(c => {
        const user = (c.usuarioId && typeof c.usuarioId === 'object') ? c.usuarioId : null;
        
        let photo = c.usuarioFoto || '';
        if (user) {
            photo = user.foto || user.fotoGoogle || photo;
        }

        return {
            ...c,
            usuarioNome: user ? user.nome : (c.usuarioNome || 'Usuário'),
            usuarioFoto: photo,
            usuarioPerfil: user ? user.perfil : (c.usuarioPerfil || 'Visitante')
        };
    });
};

exports.delete = async (req, res) => {
    try {
        const usuarioId = req.user.id || req.user._id;
        const perfil = req.user.perfil;

        const comentario = await Comentario.findById(req.params.id);
        if (!comentario) return res.status(404).json({ success: false, error: 'Não encontrado.' });

        // Verificação de permissão: Autor OU Diretor
        const isAuthor = comentario.usuarioId.toString() === usuarioId.toString();
        const isDirector = perfil === 'diretor' || perfil === 'admin';

        if (!isAuthor && !isDirector) {
            return res.status(403).json({ success: false, error: 'Não autorizado.' });
        }

        comentario.ativo = false;
        await comentario.save();

        // Decrementa contagem no comunicado se aplicável
        if (comentario.comunicadoId) {
            await Comunicado.findByIdAndUpdate(comentario.comunicadoId, { $inc: { comentariosCount: -1 } });
        }

        // Decrementa contagem na notificação se aplicável
        if (comentario.notificacaoId) {
            const Notificacao = require('../models/Notificacao');
            const mongoose = require('mongoose');
            const filter = mongoose.Types.ObjectId.isValid(comentario.notificacaoId)
                ? { $or: [{ _id: comentario.notificacaoId }, { id: comentario.notificacaoId }] }
                : { id: comentario.notificacaoId };
            await Notificacao.findOneAndUpdate(
                filter,
                { $inc: { comentariosCount: -1 } }
            );
        }

        emitirParaMensagem(
            comentario.comunicadoId || comentario.notificacaoId,
            'comentario:remove',
            {
                id: comentario._id,
                comunicadoId: comentario.comunicadoId,
                notificacaoId: comentario.notificacaoId
            }
        );

        res.json({ success: true, message: 'Comentário removido.' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};
