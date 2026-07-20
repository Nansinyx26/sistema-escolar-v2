const Nota = require('../models/Nota');
const Turma = require('../models/Turma');
const logger = require('../utils/logger');
const { escolaMatch } = require('../middleware/filtrarPorEscola');

exports.gerarMapaCalor = async(req, res) => {
    try {
        // Escopo por escola (tolerante a registros legados sem escolaId)
        const ef = escolaMatch(req.escolaId);
        const temEscola = ef && Object.keys(ef).length > 0;

        // Aceita tanto "materiaId"/"turmaId" quanto "materia"/"turma" para compatibilidade
        // com notas cadastradas antes da padronização dos campos.
        const pipeline = [
            ...(temEscola ? [{ $match: ef }] : []),
            {
                $addFields: {
                    notaNum: { $toDouble: "$nota" },
                    _materiaFinal: {
                        $cond: [
                            { $and: [{ $ifNull: ["$materiaId", false] }, { $ne: ["$materiaId", ""] }] },
                            "$materiaId",
                            { $cond: [
                                { $and: [{ $ifNull: ["$materia", false] }, { $ne: ["$materia", ""] }] },
                                "$materia",
                                null
                            ]}
                        ]
                    },
                    _turmaFinal: {
                        $cond: [
                            { $and: [{ $ifNull: ["$turmaId", false] }, { $ne: ["$turmaId", ""] }] },
                            "$turmaId",
                            { $cond: [
                                { $and: [{ $ifNull: ["$turma", false] }, { $ne: ["$turma", ""] }] },
                                "$turma",
                                null
                            ]}
                        ]
                    }
                }
            },
            { $match: { notaNum: { $ne: null }, _materiaFinal: { $ne: null }, _turmaFinal: { $ne: null } } },
            {
                $group: {
                    _id: { materia: "$_materiaFinal", turma: "$_turmaFinal" },
                    media: { $avg: "$notaNum" },
                    totalNotas: { $sum: 1 }
                }
            },
            { $sort: { "_id.turma": 1, "_id.materia": 1 } }
        ];

        const aggregatedData = await Nota.aggregate(pipeline);

        // Monta mapa de turmaId → nome legível a partir da coleção de turmas
        let turmaMap = {};
        try {
            const turmas = await Turma.find(temEscola ? ef : {}).select('_id id nome').lean();
            turmas.forEach(t => {
                const label = t.nome || t.id || String(t._id);
                if (t._id) turmaMap[String(t._id)] = label;
                if (t.id)  turmaMap[String(t.id)]  = label;
            });
        } catch (e) {
            logger.warn(`[MapaCalor] Não foi possível carregar nomes de turmas: ${e.message}`);
        }

        const resolveTurma = (id) => {
            if (!id) return id;
            return turmaMap[String(id)] || String(id);
        };

        const data = aggregatedData.map(item => ({
            materia: item._id.materia,
            turma: resolveTurma(item._id.turma),
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