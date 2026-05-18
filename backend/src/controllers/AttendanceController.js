const Falta = require('../models/Falta');

exports.list = async (req, res) => {
    try {
        const { turma, data } = req.query;
        const query = {};
        if (turma) query.turma = turma;
        if (data) query.data = data; // Atenção com datas exatas vs ranges

        const docs = await Falta.find(query).populate('aluno');
        res.json({ success: true, data: docs });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};

exports.create = async (req, res) => {
    try { const doc = await Falta.create(req.body); res.status(201).json({ success: true, data: doc }); }
    catch (e) { res.status(400).json({ success: false, error: e.message }); }
};
exports.get = async (req, res) => {
    try { const doc = await Falta.findById(req.params.id).populate('aluno'); res.json({ success: !!doc, data: doc }); }
    catch (e) { res.status(500).json({ success: false, error: e.message }); }
};
exports.update = async (req, res) => {
    try { const doc = await Falta.findByIdAndUpdate(req.params.id, req.body, { new: true }); res.json({ success: !!doc, data: doc }); }
    catch (e) { res.status(400).json({ success: false, error: e.message }); }
};
exports.delete = async (req, res) => {
    try { await Falta.findByIdAndDelete(req.params.id); res.json({ success: true }); }
    catch (e) { res.status(500).json({ success: false, error: e.message }); }
};

exports.sync = async (req, res) => {
    try {
        const { turma, data, materia, presencas } = req.body; // presencas: [{ alunoId, presente }]

        if (!turma || !data || !materia || !Array.isArray(presencas)) {
            return res.status(400).json({ success: false, error: 'Dados insuficientes para sincronização.' });
        }

        const dataBusca = new Date(data);
        const start = new Date(dataBusca); start.setHours(0, 0, 0, 0);
        const end = new Date(dataBusca); end.setHours(23, 59, 59, 999);

        // 1. Remove registros antigos desse dia/turma/materia para evitar duplicatas
        await Falta.deleteMany({
            turma,
            materia,
            data: { $gte: start, $lte: end }
        });

        // 2. Prepara novos documentos
        const docs = presencas.map(p => ({
            aluno: p.alunoId,
            turma,
            data: dataBusca,
            materia,
            presente: p.presente
        }));

        // 3. Insere em massa
        const result = await Falta.insertMany(docs);

        res.json({ success: true, count: result.length, message: 'Frequência dos alunos sincronizada com sucesso.' });
    } catch (error) {
        console.error('Erro na sincronização de faltas:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};
