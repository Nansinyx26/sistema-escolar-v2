const Especial = require('../models/Especial');

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
    try { const doc = await Especial.create(req.body); res.status(201).json({ success: true, data: doc }); }
    catch (e) { res.status(400).json({ success: false, error: e.message }); }
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
