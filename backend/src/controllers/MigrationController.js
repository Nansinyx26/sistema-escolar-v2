const MigrationService = require('../services/MigrationService');

exports.migrate = async (req, res) => {
    const key = req.headers['x-migration-key'];
    // SEGURANÇA: sem a variável configurada, undefined === undefined dava true
    // e a checagem passava. Exige a chave presente E igual.
    if (!process.env.MIGRATION_KEY || key !== process.env.MIGRATION_KEY) {
        return res.status(403).json({ success: false, error: 'Chave de migração inválida' });
    }

    try {
        const data = req.body;
        const result = await MigrationService.migrateData(data);
        res.json({ success: true, migrated: result });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};
