const Relatorio = require('../models/Relatorio');

exports.list = async (req, res) => {
    try {
        const { turma, periodo } = req.query;
        const query = {};
        if (turma) query.turma = turma;
        if (periodo) query.periodo = periodo;

        const docs = await Relatorio.find(query).sort({ data: -1 }).lean();
        const normalizedDocs = docs.map(d => ({
            ...d,
            id: d.id || d._id
        }));
        res.json({ success: true, data: normalizedDocs });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};

exports.create = async (req, res) => {
    try { const doc = await Relatorio.create(req.body); res.status(201).json({ success: true, data: doc }); }
    catch (e) { res.status(400).json({ success: false, error: e.message }); }
};
exports.get = async (req, res) => {
    try { const doc = await Relatorio.findById(req.params.id); res.json({ success: !!doc, data: doc }); }
    catch (e) { res.status(500).json({ success: false, error: e.message }); }
};
exports.update = async (req, res) => {
    try { const doc = await Relatorio.findByIdAndUpdate(req.params.id, req.body, { new: true }); res.json({ success: !!doc, data: doc }); }
    catch (e) { res.status(400).json({ success: false, error: e.message }); }
};
exports.delete = async (req, res) => {
    try { await Relatorio.findByIdAndDelete(req.params.id); res.json({ success: true }); }
    catch (e) { res.status(500).json({ success: false, error: e.message }); }
};
