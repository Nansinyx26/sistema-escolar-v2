const Comentario = require('../models/Comentario');
const Comunicado = require('../models/Comunicado');
const Usuario = require('../models/Usuario');
const NotificationService = require('../services/NotificationService');
const logger = require('../utils/logger');

exports.add = async (req, res) => {
    try {
        const { comunicadoId, texto, audioUrl, parentId } = req.body;
        const usuarioId = req.user.id || req.user._id;
 
        if (!comunicadoId || (!texto && !audioUrl)) {
            return res.status(400).json({ success: false, error: 'ComunicadoId e conteúdo (texto ou áudio) são obrigatórios.' });
        }

        const usuario = await Usuario.findById(usuarioId).lean();
        if (!usuario) {
            return res.status(404).json({ success: false, error: 'Usuário não encontrado.' });
        }

        const novoComentario = new Comentario({
            comunicadoId,
            usuarioId,
            usuarioNome: usuario.nome,
            usuarioFoto: usuario.foto || usuario.fotoGoogle || '',
            usuarioPerfil: usuario.perfil,
            texto,
            audioUrl,
            parentId: parentId || null
        });

        await novoComentario.save();

        // Incrementa contagem no comunicado
        const comunicado = await Comunicado.findByIdAndUpdate(comunicadoId, { $inc: { comentariosCount: 1 } });

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

        // Emitir evento em tempo real
        if (global.io) {
            global.io.emit('comentario:new', {
                comunicadoId,
                comentario: novoComentario
            });
        }

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

        if (global.io) {
            global.io.emit('comentario:update', { comentario });
        }

        res.json({ success: true, data: comentario });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};

exports.getByComunicado = async (req, res) => {
    try {
        const { comunicadoId } = req.params;
        const comentarios = await Comentario.find({ comunicadoId, ativo: true })
            .sort({ dataCriacao: 1 })
            .lean();
            
        res.json({ success: true, data: comentarios });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
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

        // Decrementa contagem no comunicado
        await Comunicado.findByIdAndUpdate(comentario.comunicadoId, { $inc: { comentariosCount: -1 } });

        if (global.io) {
            global.io.emit('comentario:remove', { 
                id: comentario._id,
                comunicadoId: comentario.comunicadoId 
            });
        }

        res.json({ success: true, message: 'Comentário removido.' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};
