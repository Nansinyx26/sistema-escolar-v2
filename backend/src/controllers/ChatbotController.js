const logger = require('../utils/logger');
const ChatMensagem = require('../models/ChatMensagem');
const ChatbotService = require('../services/ChatbotService');

exports.chatbot = async(req, res) => {
    try {
        let { message, alunoId } = req.body;
        const perfil = (req.user?.perfil || '').toLowerCase();
        const userId = req.user?.id || req.user?._id;
        const nomeUsuario = req.user?.nome || 'Usuário';

        if (!message || !message.trim()) {
            return res.status(400).json({ success: false, error: 'Mensagem vazia.' });
        }

        if (!perfil) {
            return res.status(403).json({ success: false, error: 'Perfil de usuário não autorizado.' });
        }

        if (message.length > 1000) {
            logger.warn(`[Chatbot] Mensagem truncada de ${message.length} para 1000 chars`);
            message = message.substring(0, 1000);
        }

        const { response, alunoId: resolvedAlunoId, options } = await ChatbotService.process({
            message,
            alunoId,
            perfil,
            userId,
            nomeUsuario,
            userEmail: req.user?.email,
        });
        logger.warn(`[ChatbotController] response="${response?.substring(0,60)}" options=${JSON.stringify(options)}`);

        const perfilParaSalvar = ['admin', 'diretor', 'professor', 'responsavel'].includes(perfil) ?
            perfil :
            'admin';
        await ChatMensagem.create({
            usuarioId: String(userId),
            usuarioPerfil: perfilParaSalvar,
            usuarioNome: nomeUsuario,
            alunoId: resolvedAlunoId || null,
            pergunta: message,
            resposta: response,
        }).catch(error => logger.warn(`[Chatbot] Erro ao salvar histórico: ${error.message}`));

        return res.json({ success: true, data: { response, alunoId: resolvedAlunoId, options: options || null } });
    } catch (error) {
        logger.error(`[Chatbot] Erro: ${error.message}`);
        return res.status(500).json({ success: false, error: 'Não foi possível processar sua pergunta. Tente novamente.' });
    }
};