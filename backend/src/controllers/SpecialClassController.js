const Especial = require('../models/Especial');
// Helper to determine category based on subject name
function getCategoria(nome) {
    const peb2 = ['Inglês', 'Artes', 'Educação Física'];
    const oficina = ['Oficina de Leitura', 'SEBRAE', 'Desenvolvimento', 'Socioemocional'];
    if (peb2.includes(nome)) return 'PEB2';
    if (oficina.includes(nome)) return 'Oficina';
    return 'PEB2';
}
exports.list = async (req, res) => {
    try {
        const docs = await Especial.find().lean();
        const normalizedDocs = docs.map(d => ({
            ...d,
            id: d.id || d._id
        }));
        res.json({ success: true, data: normalizedDocs });
    }
    catch (e) { res.status(500).json({ success: false, error: e.message }); }
};
exports.create = async (req, res) => {
    try {
        // Ensure categoria is set based on nome
        if (req.body.nome) {
            req.body.categoria = getCategoria(req.body.nome);
        }
        const doc = await Especial.create(req.body);
        res.status(201).json({ success: true, data: doc });
    } catch (e) {
        res.status(400).json({ success: false, error: e.message });
    }
};
exports.get = async (req, res) => {
    try { const doc = await Especial.findById(req.params.id); res.json({ success: !!doc, data: doc }); }
    catch (e) { res.status(500).json({ success: false, error: e.message }); }
};
exports.update = async (req, res) => {
    try { const doc = await Especial.findByIdAndUpdate(req.params.id, req.body, { new: true }); res.json({ success: !!doc, data: doc }); }
    catch (e) { res.status(400).json({ success: false, error: e.message }); }
};
exports.delete = async (req, res) => {
    try { await Especial.findByIdAndDelete(req.params.id); res.json({ success: true }); }
    catch (e) { res.status(500).json({ success: false, error: e.message }); }
};
