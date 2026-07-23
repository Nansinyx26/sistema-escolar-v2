const express = require('express');
const router = express.Router();
const AuditLog = require('../models/AuditLog');
const authorize = require('../middleware/authorize');
const escapeRegex = require('../utils/escapeRegex');

// Admin vê a rede toda; diretor vê apenas a própria escola. Antes a rota era
// só-admin e sem escopo — um diretor não conseguia auditar a própria escola,
// o que na prática desativava o controle.
router.get('/logs', authorize('admin', 'diretor'), async (req, res) => {
    try {
        const filters = {};
        if (req.query.usuario) filters.usuarioEmail = new RegExp(escapeRegex(String(req.query.usuario)), 'i');
        if (req.query.acao) filters.acao = String(req.query.acao);

        // Multi-escola: diretor é restrito ao próprio tenant
        if (req.user.perfil !== 'admin' && req.escolaId) {
            filters.escolaId = String(req.escolaId);
        }

        const logs = await AuditLog.find(filters).sort({ data: -1 }).limit(200).lean();
        res.json({ success: true, data: logs });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

module.exports = router;
