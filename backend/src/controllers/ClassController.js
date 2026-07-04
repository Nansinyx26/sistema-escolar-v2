const Turma = require('../models/Turma');
const AuditoriaService = require('../services/AuditoriaService');

exports.list = async (req, res) => {
    try {
        const query = { ativo: { $ne: false } };

        // Multi-escola: isola por tenant quando o contexto está resolvido
        if (req.escolaId) query.escolaId = req.escolaId;

        if (req.user && req.user.perfil === 'professor' && req.allowedTurmas) {
            query.nome = { $in: req.allowedTurmas };
        }

        const classes = await Turma.find(query).populate('professor').lean();
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
    try {
        if (req.escolaId && !req.body.escolaId) req.body.escolaId = req.escolaId;
        const doc = await Turma.create(req.body);
        
        // Registro de Auditoria
        await AuditoriaService.log({
            req,
            acao: 'CREATE_CLASS',
            recurso: `Turma: ${doc.nome}`,
            recursoId: doc._id || doc.id,
            detalhes: { dados: req.body }
        });

        res.status(201).json({ success: true, data: doc }); 
    }
    catch (e) { res.status(400).json({ success: false, error: e.message }); }
};

exports.get = async (req, res) => {
    try { const doc = await Turma.findOne({ $or: [{ _id: req.params.id }, { id: req.params.id }, { nome: req.params.id }] }).populate('professor'); res.json({ success: !!doc, data: doc }); }
    catch (e) { res.status(500).json({ success: false, error: e.message }); }
};

exports.update = async (req, res) => {
    try {
        delete req.body._id;
        const existingClass = await Turma.findOne({ $or: [{ _id: req.params.id }, { id: req.params.id }, { nome: req.params.id }] }).lean();
        if (!existingClass) return res.status(404).json({ success: false, error: 'Turma não encontrada.' });

        const doc = await Turma.findOneAndUpdate({ $or: [{ _id: req.params.id }, { id: req.params.id }, { nome: req.params.id }] }, req.body, { new: true }); 
        
        // Registro de Auditoria
        await AuditoriaService.log({
            req,
            acao: 'UPDATE_CLASS',
            recurso: `Turma: ${doc.nome}`,
            recursoId: doc._id || doc.id,
            detalhes: { antes: existingClass, depois: req.body }
        });

        res.json({ success: !!doc, data: doc });
    }
    catch (e) { res.status(400).json({ success: false, error: e.message }); }
};

exports.delete = async (req, res) => {
    try { 
        const existingClass = await Turma.findOne({ $or: [{ _id: req.params.id }, { id: req.params.id }, { nome: req.params.id }] }).lean();
        if (!existingClass) return res.status(404).json({ success: false, error: 'Turma não encontrada.' });

        await Turma.findOneAndDelete({ $or: [{ _id: req.params.id }, { id: req.params.id }, { nome: req.params.id }] }); 
        
        // Registro de Auditoria
        await AuditoriaService.log({
            req,
            acao: 'DELETE_CLASS',
            recurso: `Turma: ${existingClass.nome}`,
            recursoId: existingClass._id || existingClass.id,
            detalhes: { turmaExcluida: existingClass }
        });

        res.json({ success: true }); 
    }
    catch (e) { res.status(500).json({ success: false, error: e.message }); }
};
