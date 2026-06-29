const AuditLog = require('../models/AuditLog');

exports.list = async (req, res) => {
    try {
        const { usuario, acao, de, ate } = req.query;
        const filters = {};

        if (usuario) {
            // Busca por nome ou email (case-insensitive)
            filters.$or = [
                { usuarioNome: new RegExp(usuario, 'i') },
                { usuarioEmail: new RegExp(usuario, 'i') }
            ];
        }
        
        if (acao) filters.acao = acao;
        
        if (de || ate) {
            filters.data = {};
            if (de) filters.data.$gte = new Date(de);
            if (ate) filters.data.$lte = new Date(ate);
        }

        const logs = await AuditLog.find(filters)
            .sort({ data: -1 })
            .limit(200)
            .lean();

        res.json({ success: true, data: logs });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};
