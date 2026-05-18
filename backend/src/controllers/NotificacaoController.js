const Notificacao = require('../models/Notificacao');

module.exports = {
    async getAll(req, res) {
        try {
            // Se necessário, filtrar por escola
            const notificacoes = await Notificacao.find().sort({ dataCriacao: -1 }).lean();
            
            // Format to match frontend structure (the frontend expects res.json({ success: true, data: [...] }))
            res.json({ success: true, data: notificacoes });
        } catch (error) {
            console.error('Erro em NotificacaoController.getAll:', error);
            res.status(500).json({ success: false, error: 'Erro ao buscar notificações', details: error.message });
        }
    },

    async create(req, res) {
        try {
            const data = req.body;
            
            // Ensure ID exists
            if (!data.id) {
                data.id = 'notif_' + Date.now();
            }
            
            const notificacao = await Notificacao.create(data);
            res.status(201).json({ success: true, data: notificacao });
        } catch (error) {
            console.error('Erro em NotificacaoController.create:', error);
            res.status(400).json({ success: false, error: 'Erro ao criar notificação', details: error.message });
        }
    },

    async delete(req, res) {
        try {
            const { id } = req.params;
            const deleted = await Notificacao.findOneAndDelete({ $or: [{ _id: id }, { id: id }] });
            
            if (!deleted) {
                return res.status(404).json({ success: false, error: 'Notificação não encontrada' });
            }
            res.json({ success: true, message: 'Notificação removida com sucesso' });
        } catch (error) {
            console.error('Erro em NotificacaoController.delete:', error);
            res.status(500).json({ success: false, error: 'Erro ao deletar notificação', details: error.message });
        }
    }
};
