const express = require('express');
const router = express.Router();
const AuditLog = require('../models/AuditLog');
const authorize = require('../middleware/authorize');
const escapeRegex = require('../utils/escapeRegex');

router.get('/logs', authorize('admin'), async (req, res) => {
    try {
        const filters = {};
        if (req.query.usuario) filters.usuarioEmail = new RegExp(escapeRegex(req.query.usuario), 'i');
        if (req.query.acao) filters.acao = req.query.acao;
        
        const logs = await AuditLog.find(filters).sort({ data: -1 }).limit(200);
        res.json({ success: true, data: logs });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

module.exports = router;
