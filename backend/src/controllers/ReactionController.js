const MessageReaction = require('../models/MessageReaction');
const RealtimeNotification = require('../models/RealtimeNotification');
const { emitirParaMensagem } = require('../utils/realtime');

exports.addOrUpdate = async (req, res) => {
    try {
        const { messageId, emoji, parentName, studentName } = req.body;
        const senderId = req.user.id || req.user._id;
        const senderType = req.user.perfil;
        const senderName = req.user.nome || 'Usuário';

        if (!messageId || !emoji) {
            return res.status(400).json({ success: false, error: 'messageId e emoji são obrigatórios.' });
        }

        const allowedEmojis = [
            '👍', '❤️', '😂', '😮', '😢', '👏', '🔥', '🎉'
        ];
        if (!allowedEmojis.includes(emoji)) {
            return res.status(400).json({ success: false, error: 'Emoji não permitido.' });
        }

        const queryId = String(senderId);
        // Upsert: cria ou atualiza a reação do usuário nesta mensagem
        const reaction = await MessageReaction.findOneAndUpdate(
            { messageId, senderId: queryId },
            {
                messageId, senderId: queryId, senderType, senderName,
                parentName: parentName || '', studentName: studentName || '',
                escolaId: req.escolaId || req.session?.escolaAtivaId || undefined,
                emoji, updatedAt: new Date()
            },
            { upsert: true, new: true, setDefaultsOnInsert: true }
        );

        const isNew = reaction.createdAt.getTime() === reaction.updatedAt.getTime();

        // Buscar todas as reações desta mensagem para retornar
        const allReactions = await MessageReaction.find({ messageId }).lean();
        const summary = buildReactionSummary(allReactions);

        // Emitir apenas na sala da mensagem. O emit global adicional entregava
        // o resumo de reações (nome e perfil de quem reagiu) a todos os
        // sockets conectados, inclusive de conversas de outras escolas.
        emitirParaMensagem(messageId, isNew ? 'reaction:add' : 'reaction:update', {
            messageId, reaction, allReactions, summary
        });

        res.status(isNew ? 201 : 200).json({
            success: true,
            data: reaction,
            allReactions,
            summary
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};

exports.remove = async (req, res) => {
    try {
        const senderId = req.user.id || req.user._id;
        const { messageId } = req.params;

        const queryId = String(senderId);
        const deleted = await MessageReaction.findOneAndDelete({ messageId, senderId: queryId });
        if (!deleted) {
            return res.status(404).json({ success: false, error: 'Reação não encontrada.' });
        }

        const allReactions = await MessageReaction.find({ messageId }).lean();

        emitirParaMensagem(messageId, 'reaction:remove', {
            messageId, senderId, allReactions,
            summary: buildReactionSummary(allReactions)
        });

        res.json({ success: true, message: 'Reação removida.', allReactions });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};

exports.getByMessage = async (req, res) => {
    try {
        const { messageId } = req.params;
        const reactions = await MessageReaction.find({ messageId }).sort({ createdAt: -1 }).lean();
        res.json({ 
            success: true, 
            data: reactions,
            summary: buildReactionSummary(reactions)
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};

// Helper: Agrupa reações por emoji com contagem
function buildReactionSummary(reactions) {
    const summary = {};
    reactions.forEach(r => {
        if (!summary[r.emoji]) {
            summary[r.emoji] = { count: 0, users: [] };
        }
        summary[r.emoji].count++;
        summary[r.emoji].users.push({ name: r.senderName, type: r.senderType });
    });
    return summary;
}
