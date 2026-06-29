const Config = require('../models/Config');

const ConfigController = {
    async get(req, res) {
        try {
            // Tenta pegar pelo ID padrão ou o primeiro que achar
            let config = await Config.findById('config001');
            if (!config) {
                config = await Config.findOne();
            }

            if (!config) {
                // Se não existir, retorna padrão mockado ou erro, mas idealmente o setup cria
                return res.status(404).json({ success: false, error: 'Configuração não encontrada' });
            }

            res.json({ success: true, data: config });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    },

    async update(req, res) {
        try {
            const { id } = req.params;
            const updates = req.body;
            delete updates._id;

            const config = await Config.findByIdAndUpdate(id, updates, { new: true });
            if (!config) {
                return res.status(404).json({ success: false, error: 'Configuração não encontrada' });
            }

            res.json({ success: true, data: config });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    }
};

module.exports = ConfigController;
