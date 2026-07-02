const express = require('express');
const router = express.Router();
const ChatMensagem = require('../models/ChatMensagem');
const authJWT = require('../middleware/authJWT');

/**
 * Rota para buscar o histórico de conversas do chatbot do usuário logado.
 */
router.get('/historico', authJWT, async (req, res) => {
    try {
        const userId = req.user.id || req.user._id;
        const mensagens = await ChatMensagem.find({ usuarioId: String(userId) })
            .sort({ criadoEm: 1 })
            .limit(50)
            .lean();
        
        res.json({ success: true, data: mensagens });
    } catch (error) {
        res.status(500).json({ success: false, error: 'Erro ao carregar histórico.' });
    }
});

module.exports = router;
