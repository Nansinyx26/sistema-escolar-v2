/**
 * TabelaGeralController
 * ─────────────────────
 * GET  /api/tabela-geral              → grade completa (todas as turmas e dias)
 * GET  /api/tabela-geral/sala/:id     → horário de uma sala (turmaId)
 * GET  /api/tabela-geral/prof/:key    → horário de um professor
 * PUT  /api/tabela-geral/celula       → atualiza célula (com validação de conflito)
 * POST /api/tabela-geral/seed         → popula banco com dados da grade atual
 * DELETE /api/tabela-geral/reset      → limpa coleção (use com cuidado)
 */

const TabelaGeral = require('../models/TabelaGeral');

// ─── Dados originais da grade (mesmo que horario-jaguari.js) ─────────────────
const TURMAS = [
    '1ºA','1ºB','1ºC','2ºA','2ºB','2ºC',
    '3ºA','3ºB','3ºC','4ºA','4ºB','4ºC',
    '5ºA','5ºB','5ºC','5ºD'
];
const TURMAS_IDS = [
    '1A','1B','1C','2A','2B','2C',
    '3A','3B','3C','4A','4B','4C',
    '5A','5B','5C','5D'
];
const DIAS = ['SEGUNDA','TERÇA','QUARTA','QUINTA','SEXTA'];

const DADOS = {
    SEGUNDA: [
        ['','I','OL','','','',''],
        ['','','EF','I','','',''],
        ['','MK','I','','','',''],
        ['','','','','','A','A'],
        ['EF','EF','','','','','I'],
        ['I','A','','EF','','',''],
        ['','','','','','I',''],
        ['A','','','','','PEF','EF'],
        ['','','','','','','DSE'],
        ['','','','MK','','',''],
        ['','','','','','MK',''],
        ['','','MK','','','',''],
        ['EF','EF','','','A','',''],
        ['','','','','I','',''],
        ['','','','','EF','',''],
        ['','','A','A','OL','','']
    ],
    TERÇA: [
        ['','','','','','EF','DSE'],
        ['','','MK','','','',''],
        ['','','','EF','','',''],
        ['EF','EF','','','','',''],
        ['','','','','','',''],
        ['','','','','','DSE','EF'],
        ['','','EF','','','A','A'],
        ['OL','DSE','I','','','',''],
        ['','','A','A','','',''],
        ['','','','','EF','OL','I'],
        ['','','','','','I','EF'],
        ['','','','I','','',''],
        ['','','','MK','I','',''],
        ['A','A','EF','','','',''],
        ['DSE','I','OL','','','',''],
        ['I','EF','DSE','','','MK','']
    ],
    QUARTA: [
        ['','','','EF','','',''],
        ['','','EF','','','',''],
        ['','','','','','DSE','OL'],
        ['','','','','OL','I','DSE'],
        ['','','A','A','EF','MK',''],
        ['','','','','A','',''],
        ['','','MK','','','',''],
        ['','','','','','EF','EF'],
        ['','','','','','','I'],
        ['','','','','','',''],
        ['A','A','','OL','','',''],
        ['','','','','DSE','A','A'],
        ['','EF','','','','',''],
        ['','','','','','EF','EF'],
        ['','','EF','EF','','',''],
        ['','','','','','','']
    ],
    QUINTA: [
        ['A','A','EF','','','',''],
        ['','','PAR','A','A','DSE','OL'],
        ['','EF','','','','A','A'],
        ['','','','EF','','',''],
        ['','','','','','',''],
        ['EF','OL','','','','',''],
        ['','','','','EF','',''],
        ['','','','A','','',''],
        ['','','','MK','OL','EF','EF'],
        ['A','A','EF','EF','','',''],
        ['','','DSE','','','',''],
        ['EF','EF','OL','','','',''],
        ['','','','','A','OL','DSE'],
        ['OL','DSE','MK','','','',''],
        ['','MK','','','','A','A'],
        ['','','','','','','']
    ],
    SEXTA: [
        ['','','','','','MK',''],
        ['','','EF','','','',''],
        ['','','','EF','','',''],
        ['','','MK','','','',''],
        ['','','','','','DSE','OL'],
        ['','','','MK','','',''],
        ['EF','','','','','OL','DSE'],
        ['','MK','','','','',''],
        ['','EF','','','','',''],
        ['','DSE','','','','',''],
        ['','','EF','EF','','',''],
        ['','EF','','','','',''],
        ['','Lima','','','','',''],
        ['','','Lima','','','',''],
        ['','','','Lima','','',''],
        ['','','','','Lima','EF','EF']
    ]
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Chaves que NÍO geram conflito (reuniões de pares, PEB1, vazio) */
const SEM_CONFLITO = new Set(['', 'EF_PARES', 'ARTES_PARES']);

function buildResponseOk(data) {
    return { success: true, data };
}

function buildResponseError(status, message, extra = {}) {
    return { success: false, error: message, ...extra };
}

// ─── GET /api/tabela-geral ───────────────────────────────────────────────────
exports.list = async (req, res) => {
    try {
        const cells = await TabelaGeral.find({}).lean();

        // Agrupar por turmaId → dia → aulaIdx para facilitar o frontend
        const grouped = {};
        cells.forEach(c => {
            if (!grouped[c.turmaId]) grouped[c.turmaId] = {};
            if (!grouped[c.turmaId][c.dia]) grouped[c.turmaId][c.dia] = [];
            grouped[c.turmaId][c.dia][c.aulaIdx] = c.abrev || '';
        });

        res.json(buildResponseOk({ cells, grouped }));
    } catch (err) {
        res.status(500).json(buildResponseError(500, err.message));
    }
};

// ─── GET /api/tabela-geral/sala/:turmaId ─────────────────────────────────────
exports.getSala = async (req, res) => {
    try {
        const { turmaId } = req.params;
        const cells = await TabelaGeral.find({ turmaId }).sort({ dia: 1, aulaIdx: 1 }).lean();

        // Agrupar por dia
        const byDia = {};
        cells.forEach(c => {
            if (!byDia[c.dia]) byDia[c.dia] = new Array(7).fill('');
            byDia[c.dia][c.aulaIdx] = c.abrev || '';
        });

        res.json(buildResponseOk({ turmaId, horarios: byDia }));
    } catch (err) {
        res.status(500).json(buildResponseError(500, err.message));
    }
};

// ─── GET /api/tabela-geral/prof/:professorKey ─────────────────────────────────
exports.getProfessor = async (req, res) => {
    try {
        const { professorKey } = req.params;
        if (!professorKey) return res.status(400).json(buildResponseError(400, 'professorKey obrigatório'));

        const cells = await TabelaGeral.find({
            professorKey,
            abrev: { $ne: '' }
        }).sort({ dia: 1, aulaIdx: 1 }).lean();

        // Agrupar por dia → aulaIdx → [{ turmaId, turmaNome, abrev, horarioLabel }]
        const byDia = {};
        cells.forEach(c => {
            if (!byDia[c.dia]) byDia[c.dia] = {};
            byDia[c.dia][c.aulaIdx] = {
                turmaId: c.turmaId,
                turmaNome: c.turmaNome,
                abrev: c.abrev,
                horarioLabel: c.horarioLabel
            };
        });

        const nomeProfessor = TabelaGeral.PROFESSOR_NOME[professorKey] || professorKey;
        res.json(buildResponseOk({ professorKey, nomeProfessor, horarios: byDia }));
    } catch (err) {
        res.status(500).json(buildResponseError(500, err.message));
    }
};

// ─── PUT /api/tabela-geral/celula ────────────────────────────────────────────
/**
 * Body esperado:
 * {
 *   turmaId: '2A',
 *   dia: 'SEGUNDA',
 *   aulaIdx: 0,
 *   abrev: 'EF',
 *   professorKey: 'MARJORIE'   ← opcional: se não vier, é calculado aqui
 * }
 */
exports.updateCell = async (req, res) => {
    try {
        const { turmaId, dia, aulaIdx, abrev } = req.body;

        // Validações básicas
        if (!turmaId || !dia || aulaIdx === undefined) {
            return res.status(400).json(buildResponseError(400, 'turmaId, dia e aulaIdx são obrigatórios'));
        }
        if (!TabelaGeral.DIAS_VALIDOS.includes(dia)) {
            return res.status(400).json(buildResponseError(400, `Dia inválido: ${dia}`));
        }
        if (aulaIdx < 0 || aulaIdx > 6) {
            return res.status(400).json(buildResponseError(400, `aulaIdx deve ser 0–6`));
        }

        // Determina professorKey (vem do body ou calculado pelo model)
        const professorKey = req.body.professorKey !== undefined
            ? req.body.professorKey
            : TabelaGeral.getProfessorKey(abrev, turmaId);

        // ── Validação de conflito ──────────────────────────────────────────
        if (professorKey && !SEM_CONFLITO.has(professorKey)) {
            const conflito = await TabelaGeral.findOne({
                professorKey,
                dia,
                aulaIdx: Number(aulaIdx),
                turmaId: { $ne: turmaId }   // outra sala, mesmo professor
            }).lean();

            if (conflito) {
                const nomeProfessor = TabelaGeral.PROFESSOR_NOME[professorKey] || professorKey;
                return res.status(409).json({
                    success: false,
                    conflict: true,
                    message: `Conflito de horário: ${nomeProfessor} já está na ${conflito.turmaNome} às ${conflito.horarioLabel} de ${dia}`,
                    detalhe: {
                        sala: conflito.turmaNome,
                        horario: conflito.horarioLabel,
                        professor: nomeProfessor,
                        disciplina: conflito.abrev,
                        dia
                    }
                });
            }
        }

        // ── Salva / Atualiza no banco ──────────────────────────────────────
        const horarioLabel = TabelaGeral.HORARIO_LABELS[aulaIdx] || '';
        const turmaIdx     = TURMAS_IDS.indexOf(turmaId);
        const turmaNome    = turmaIdx >= 0 ? TURMAS[turmaIdx] : turmaId;

        const updated = await TabelaGeral.findOneAndUpdate(
            { turmaId, dia, aulaIdx: Number(aulaIdx) },
            {
                $set: {
                    turmaNome,
                    horarioLabel,
                    abrev: abrev || '',
                    professorKey: professorKey || '',
                    updatedAt: new Date()
                }
            },
            { upsert: true, new: true }
        );

        res.json(buildResponseOk(updated));
    } catch (err) {
        // Erro de duplicidade (código 11000 do MongoDB)
        if (err.code === 11000) {
            return res.status(409).json(buildResponseError(409, 'Célula já existe (duplicidade)'));
        }
        res.status(500).json(buildResponseError(500, err.message));
    }
};

// ─── POST /api/tabela-geral/seed ─────────────────────────────────────────────
/**
 * Popula a coleção com os dados oficiais da grade.
 * Usa updateOne com upsert → idempotente (pode rodar várias vezes).
 */
exports.seed = async (req, res) => {
    try {
        const ops = [];

        DIAS.forEach(dia => {
            const diaRows = DADOS[dia];
            TURMAS.forEach((turmaNome, turmaIdx) => {
                const turmaId = TURMAS_IDS[turmaIdx];
                const aulas   = diaRows[turmaIdx] || [];

                aulas.forEach((abrev, aulaIdx) => {
                    const professorKey   = TabelaGeral.getProfessorKey(abrev, turmaId);
                    const horarioLabel   = TabelaGeral.HORARIO_LABELS[aulaIdx] || '';

                    ops.push({
                        updateOne: {
                            filter: { turmaId, dia, aulaIdx },
                            update: {
                                $set: {
                                    turmaNome,
                                    horarioLabel,
                                    abrev: abrev || '',
                                    professorKey: professorKey || '',
                                    updatedAt: new Date()
                                }
                            },
                            upsert: true
                        }
                    });
                });
            });
        });

        const result = await TabelaGeral.bulkWrite(ops, { ordered: false });

        res.json(buildResponseOk({
            message: `Seed concluído: ${result.upsertedCount} inseridos, ${result.modifiedCount} atualizados`,
            total: ops.length,
            upserted: result.upsertedCount,
            modified: result.modifiedCount
        }));
    } catch (err) {
        res.status(500).json(buildResponseError(500, err.message));
    }
};

// ─── DELETE /api/tabela-geral/reset ──────────────────────────────────────────
exports.reset = async (req, res) => {
    try {
        const r = await TabelaGeral.deleteMany({});
        res.json(buildResponseOk({ message: `${r.deletedCount} registros removidos` }));
    } catch (err) {
        res.status(500).json(buildResponseError(500, err.message));
    }
};
