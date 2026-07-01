const Nota = require('../models/Nota');
const logger = require('../utils/logger');

exports.gerarMapaCalor = async(req, res) => {
    try {
        const pipeline = [
            { $addFields: { notaNum: { $toDouble: "$nota" } } },
            { $match: { notaNum: { $ne: null }, materiaId: { $exists: true, $ne: null }, turmaId: { $exists: true, $ne: null } } },
            {
                $group: {
                    _id: { materia: "$materiaId", turma: "$turmaId" },
                    media: { $avg: "$notaNum" },
                    totalNotas: { $sum: 1 }
                }
            },
            { $sort: { "_id.turma": 1, "_id.materia": 1 } }
        ];

        const aggregatedData = await Nota.aggregate(pipeline);

        const data = aggregatedData.map(item => ({
            materia: item._id.materia,
            turma: item._id.turma,
            media: item.media != null ? parseFloat(item.media.toFixed(2)) : 0,
            totalNotas: item.totalNotas || 0
        }));

        logger.info(`[MapaCalor] ${data.length} combinações matéria×turma retornadas.`);
        res.json({ success: true, data });
    } catch (error) {
        logger.error(`[MapaCalorController] Erro em gerarMapaCalor: ${error.message}`);
        res.status(500).json({ success: false, error: 'Erro ao gerar mapa de calor.' });
    }
};