/**
 * NoteController.js — Módulo de Notas Completo (Roadmap #8)
 * ============================================
 * Melhorias implementadas:
 *   - Validação de intervalo 0–10 em create e update
 *   - Whitelist de campos (previne injeção de parâmetros)
 *   - GET /notas/media/:alunoId  → médias por bimestre e geral
 *   - GET /notas/boletim/:alunoId → boletim completo estruturado
 *   - Controle de acesso horizontal já integrado
 */

const Nota = require('../models/Nota');
const Aluno = require('../models/Aluno');

// Whitelist de campos permitidos
const NOTE_WHITELIST = ['alunoId', 'matriculaId', 'turmaId', 'materiaId', 'bimestre', 'tipo', 'nota', 'descricao', 'data'];

// Valida nota no intervalo 0–10
function validarNota(valor) {
    const n = parseFloat(valor);
    if (isNaN(n) || n < 0 || n > 10) {
        return { valido: false, msg: 'A nota deve ser um número entre 0 e 10.' };
    }
    return { valido: true, valor: Math.round(n * 10) / 10 }; // 1 casa decimal
}

// --------------------------------------------------
// GET /api/notas
// --------------------------------------------------
exports.list = async (req, res) => {
    try {
        const filters = {};
        if (req.query.alunoId)   filters.alunoId   = req.query.alunoId;
        if (req.query.turmaId)   filters.turmaId   = req.query.turmaId;
        if (req.query.materiaId) filters.materiaId = req.query.materiaId;
        if (req.query.bimestre)  filters.bimestre  = Number(req.query.bimestre);

        // Controle de acesso horizontal para professores
        if (req.horizontalFilter) {
            Object.assign(filters, req.horizontalFilter);
        }

        const notes = await Nota.find(filters).sort({ bimestre: 1, data: -1 }).lean();

        // Enriquece com nome do aluno
        const studentIds = [...new Set(notes.map(n => String(n.alunoId)))];
        const students   = await Aluno.find({
            $or: [{ id: { $in: studentIds } }, { _id: { $in: studentIds } }]
        }).select('id _id nome').lean();

        const studentMap = {};
        students.forEach(s => {
            if (s.id)  studentMap[String(s.id)]  = s.nome;
            if (s._id) studentMap[String(s._id)] = s.nome;
        });

        const normalizedNotes = notes.map(note => ({
            ...note,
            id: note.id || note._id,
            alunoNome: studentMap[String(note.alunoId)] || 'Aluno Desconhecido'
        }));

        res.json({ success: true, data: normalizedNotes });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};

// --------------------------------------------------
// POST /api/notas — com validação 0–10
// --------------------------------------------------
exports.create = async (req, res) => {
    try {
        // Whitelist
        const body = {};
        NOTE_WHITELIST.forEach(f => { if (req.body[f] !== undefined) body[f] = req.body[f]; });

        // Valida nota
        if (body.nota !== undefined) {
            const check = validarNota(body.nota);
            if (!check.valido) return res.status(400).json({ success: false, error: check.msg });
            body.nota = check.valor;
        }

        const doc = await Nota.create(body);
        res.status(201).json({ success: true, data: doc });
    } catch (e) {
        res.status(400).json({ success: false, error: e.message });
    }
};

// --------------------------------------------------
// GET /api/notas/:id
// --------------------------------------------------
exports.get = async (req, res) => {
    try {
        const doc = await Nota.findOne({ $or: [{ _id: req.params.id }, { id: req.params.id }] });
        if (!doc) return res.status(404).json({ success: false, error: 'Nota não encontrada.' });
        res.json({ success: true, data: doc });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
};

// --------------------------------------------------
// PUT /api/notas/:id — com validação 0–10
// --------------------------------------------------
exports.update = async (req, res) => {
    try {
        // Whitelist
        const body = {};
        NOTE_WHITELIST.forEach(f => { if (req.body[f] !== undefined) body[f] = req.body[f]; });

        // Valida nota
        if (body.nota !== undefined) {
            const check = validarNota(body.nota);
            if (!check.valido) return res.status(400).json({ success: false, error: check.msg });
            body.nota = check.valor;
        }

        const doc = await Nota.findOneAndUpdate(
            { $or: [{ _id: req.params.id }, { id: req.params.id }] },
            body,
            { new: true, runValidators: false }
        );
        if (!doc) return res.status(404).json({ success: false, error: 'Nota não encontrada.' });
        res.json({ success: true, data: doc });
    } catch (e) {
        res.status(400).json({ success: false, error: e.message });
    }
};

// --------------------------------------------------
// DELETE /api/notas/:id
// --------------------------------------------------
exports.delete = async (req, res) => {
    try {
        await Nota.findOneAndDelete({ $or: [{ _id: req.params.id }, { id: req.params.id }] });
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
};

// --------------------------------------------------
// GET /api/notas/media/:alunoId
// Retorna média por bimestre e média geral do aluno.
// --------------------------------------------------
exports.getMedia = async (req, res) => {
    try {
        const { alunoId } = req.params;

        const notas = await Nota.find({
            $or: [{ alunoId }, { alunoId: alunoId }]
        }).lean();

        if (!notas.length) {
            return res.json({ success: true, data: { bimestres: {}, mediaGeral: null } });
        }

        // Agrupa por bimestre e calcula médias
        const porBimestre = {};
        notas.forEach(n => {
            const b = String(n.bimestre || 'S/B');
            if (!porBimestre[b]) porBimestre[b] = { notas: [], soma: 0, count: 0 };
            if (n.nota !== undefined && n.nota !== null) {
                porBimestre[b].notas.push(n.nota);
                porBimestre[b].soma   += parseFloat(n.nota);
                porBimestre[b].count  += 1;
            }
        });

        const bimestres = {};
        let somaGeral = 0;
        let countGeral = 0;

        Object.entries(porBimestre).forEach(([bim, dados]) => {
            const media = dados.count > 0
                ? Math.round((dados.soma / dados.count) * 10) / 10
                : null;
            bimestres[bim] = { media, qtdNotas: dados.count, notas: dados.notas };
            if (media !== null) { somaGeral += media; countGeral++; }
        });

        const mediaGeral = countGeral > 0
            ? Math.round((somaGeral / countGeral) * 10) / 10
            : null;

        res.json({ success: true, data: { bimestres, mediaGeral } });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
};

// --------------------------------------------------
// GET /api/notas/boletim/:alunoId
// Boletim completo: dados do aluno + notas por matéria/bimestre.
// --------------------------------------------------
exports.getBoletim = async (req, res) => {
    try {
        const { alunoId } = req.params;

        const [aluno, notas] = await Promise.all([
            Aluno.findOne({ $or: [{ _id: alunoId }, { id: alunoId }] })
                .select('nome matricula turma turmaId nascimento').lean(),
            Nota.find({ $or: [{ alunoId }, { alunoId: alunoId }] })
                .sort({ bimestre: 1 }).lean()
        ]);

        if (!aluno) return res.status(404).json({ success: false, error: 'Aluno não encontrado.' });

        // Estrutura: { materia: { bimestre: [notas] } }
        const boletim = {};
        notas.forEach(n => {
            const materia  = n.materiaId || n.descricao || 'Geral';
            const bimestre = String(n.bimestre || '?');
            if (!boletim[materia]) boletim[materia] = {};
            if (!boletim[materia][bimestre]) boletim[materia][bimestre] = [];
            boletim[materia][bimestre].push({ nota: n.nota, tipo: n.tipo, data: n.data });
        });

        // Calcula médias por matéria/bimestre
        const boletimComMedias = {};
        Object.entries(boletim).forEach(([materia, bimestres]) => {
            boletimComMedias[materia] = {};
            Object.entries(bimestres).forEach(([bim, lnotas]) => {
                const vals   = lnotas.map(n => parseFloat(n.nota)).filter(v => !isNaN(v));
                const media  = vals.length ? Math.round((vals.reduce((a,b) => a+b,0)/vals.length)*10)/10 : null;
                boletimComMedias[materia][bim] = { media, notas: lnotas };
            });
        });

        res.json({
            success: true,
            data: {
                aluno: { id: aluno._id, nome: aluno.nome, matricula: aluno.matricula, turma: aluno.turma || aluno.turmaId },
                boletim: boletimComMedias,
                totalNotas: notas.length,
                geradoEm: new Date().toISOString()
            }
        });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
};

// End of NoteController
