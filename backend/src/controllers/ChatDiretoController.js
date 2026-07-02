const ChatDireto = require('../models/ChatDireto');
const logger = require('../utils/logger');

exports.enviarMensagem = async (req, res) => {
    try {
        const { destinatarioId, mensagem, turmaId, alunoId, contexto } = req.body;
        const remetenteId = req.user.id;

        const novaMensagem = await ChatDireto.create({
            remetenteId,
            destinatarioId,
            turmaId,
            alunoId,
            contexto,
            mensagem
        });

        res.json({ success: true, data: novaMensagem });
    } catch (error) {
        logger.error(`[ChatDireto] Erro: ${error.message}`);
        res.status(500).json({ success: false, error: 'Erro ao enviar mensagem.' });
    }
};

exports.getHistorico = async (req, res) => {
    try {
        const { outroUsuarioId } = req.params;
        const meuId = req.user.id;

        const mensagens = await ChatDireto.find({
            $or: [
                { remetenteId: meuId, destinatarioId: outroUsuarioId },
                { remetenteId: outroUsuarioId, destinatarioId: meuId }
            ]
        }).sort({ createdAt: 1 }).lean();

        res.json({ success: true, data: mensagens });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};

exports.marcarComoLida = async (req, res) => {
    try {
        const { mensagemId } = req.params;
        await ChatDireto.findByIdAndUpdate(mensagemId, { lida: true });
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};
