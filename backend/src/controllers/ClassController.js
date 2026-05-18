const Turma = require('../models/Turma');

exports.list = async (req, res) => {
    try {
        const query = { ativo: { $ne: false } };
        
        // Se for professor, vê apenas as turmas que lhe foram atribuídas
        if (req.user && req.user.perfil === 'professor' && req.allowedTurmas) {
            query.nome = { $in: req.allowedTurmas };
        }

        const classes = await Turma.find(query).populate('professor').lean();

        // Normalização para o frontend
        const normalizedClasses = classes.map(c => ({
            ...c,
            id: c.id || c._id
        }));

        res.json({ success: true, data: normalizedClasses });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};

exports.create = async (req, res) => {
    try { const doc = await Turma.create(req.body); res.status(201).json({ success: true, data: doc }); }
    catch (e) { res.status(400).json({ success: false, error: e.message }); }
};
exports.get = async (req, res) => {
    try { const doc = await Turma.findOne({ $or: [{ _id: req.params.id }, { id: req.params.id }, { nome: req.params.id }] }).populate('professor'); res.json({ success: !!doc, data: doc }); }
    catch (e) { res.status(500).json({ success: false, error: e.message }); }
};
exports.update = async (req, res) => {
    try {
        delete req.body._id;
        const doc = await Turma.findOneAndUpdate({ $or: [{ _id: req.params.id }, { id: req.params.id }, { nome: req.params.id }] }, req.body, { new: true }); res.json({ success: !!doc, data: doc });
    }
    catch (e) { res.status(400).json({ success: false, error: e.message }); }
};
exports.delete = async (req, res) => {
    try { await Turma.findOneAndDelete({ $or: [{ _id: req.params.id }, { id: req.params.id }, { nome: req.params.id }] }); res.json({ success: true }); }
    catch (e) { res.status(500).json({ success: false, error: e.message }); }
};
