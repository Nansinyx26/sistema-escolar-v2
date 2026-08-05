const AuditLog = require('../models/AuditLog');
const escapeRegex = require('../utils/escapeRegex');

exports.list = async (req, res) => {
    try {
        const { usuario, acao, de, ate } = req.query;
        const filters = {};

        if (usuario) {
            // Regex ESCAPADA — sem isso ?usuario=(a+)+$ travava o event loop (ReDoS)
            const termo = escapeRegex(String(usuario));
            filters.$or = [
                { usuarioNome: new RegExp(termo, 'i') },
                { usuarioEmail: new RegExp(termo, 'i') }
            ];
        }

        // Multi-escola: diretor vê apenas a própria escola
        if (req.user?.perfil !== 'admin' && req.escolaId) {
            filters.escolaId = String(req.escolaId);
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
