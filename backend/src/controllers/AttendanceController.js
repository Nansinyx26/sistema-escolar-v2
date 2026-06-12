const Falta = require('../models/Falta');

exports.list = async (req, res) => {
    try {
        const { turma, data } = req.query;
        const query = {};
        if (turma) query.turma = turma;
        if (data) query.data = data; // Atenção com datas exatas vs ranges

        // --- SEGURANÇA: Verificação Horizontal para Professor (Prevenção IDOR) ---
        if (req.user && req.user.perfil === 'professor') {
            const allowed = req.allowedTurmas || [];
            if (turma) {
                if (!allowed.includes(turma)) {
                    return res.status(403).json({ success: false, error: 'Acesso negado. Você não tem permissão para visualizar faltas desta turma.' });
                }
            } else {
                query.turma = { $in: allowed };
            }
        }
        // -------------------------------------------------------------------------

        const docs = await Falta.find(query).populate('aluno');
        res.json({ success: true, data: docs });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};

exports.create = async (req, res) => {
    try {
        const { turma } = req.body;
        // --- SEGURANÇA: Verificação Horizontal para Professor (Prevenção IDOR) ---
        if (req.user && req.user.perfil === 'professor') {
            const allowed = req.allowedTurmas || [];
            if (!turma || !allowed.includes(turma)) {
                return res.status(403).json({ success: false, error: 'Acesso negado. Você não tem permissão para registrar faltas para esta turma.' });
            }
        }
        // -------------------------------------------------------------------------

        const doc = await Falta.create(req.body); 
        res.status(201).json({ success: true, data: doc }); 
    }
    catch (e) { res.status(400).json({ success: false, error: e.message }); }
};

exports.get = async (req, res) => {
    try { 
        const doc = await Falta.findById(req.params.id).populate('aluno'); 
        if (!doc) return res.status(404).json({ success: false, error: 'Registro não encontrado.' });

        // --- SEGURANÇA: Verificação Horizontal para Professor (Prevenção IDOR) ---
        if (req.user && req.user.perfil === 'professor') {
            const allowed = req.allowedTurmas || [];
            if (!allowed.includes(doc.turma)) {
                return res.status(403).json({ success: false, error: 'Acesso negado. Você não tem permissão para acessar este registro.' });
            }
        }
        // -------------------------------------------------------------------------

        res.json({ success: true, data: doc }); 
    }
    catch (e) { res.status(500).json({ success: false, error: e.message }); }
};

exports.update = async (req, res) => {
    try { 
        const doc = await Falta.findById(req.params.id);
        if (!doc) return res.status(404).json({ success: false, error: 'Registro não encontrado.' });

        // --- SEGURANÇA: Verificação Horizontal para Professor (Prevenção IDOR) ---
        if (req.user && req.user.perfil === 'professor') {
            const allowed = req.allowedTurmas || [];
            if (!allowed.includes(doc.turma)) {
                return res.status(403).json({ success: false, error: 'Acesso negado. Você não tem permissão para modificar este registro.' });
            }
            if (req.body.turma && !allowed.includes(req.body.turma)) {
                return res.status(403).json({ success: false, error: 'Acesso negado. Você não pode mover registros para esta turma.' });
            }
        }
        // -------------------------------------------------------------------------

        const updatedDoc = await Falta.findByIdAndUpdate(req.params.id, req.body, { new: true }); 
        res.json({ success: true, data: updatedDoc }); 
    }
    catch (e) { res.status(400).json({ success: false, error: e.message }); }
};

exports.delete = async (req, res) => {
    try { 
        const doc = await Falta.findById(req.params.id);
        if (!doc) return res.status(404).json({ success: false, error: 'Registro não encontrado.' });

        // --- SEGURANÇA: Verificação Horizontal para Professor (Prevenção IDOR) ---
        if (req.user && req.user.perfil === 'professor') {
            const allowed = req.allowedTurmas || [];
            if (!allowed.includes(doc.turma)) {
                return res.status(403).json({ success: false, error: 'Acesso negado. Você não tem permissão para deletar este registro.' });
            }
        }
        // -------------------------------------------------------------------------

        await Falta.findByIdAndDelete(req.params.id); 
        res.json({ success: true }); 
    }
    catch (e) { res.status(500).json({ success: false, error: e.message }); }
};

exports.sync = async (req, res) => {
    try {
        const { turma, data, materia, presencas } = req.body; // presencas: [{ alunoId, presente }]

        if (!turma || !data || !materia || !Array.isArray(presencas)) {
            return res.status(400).json({ success: false, error: 'Dados insuficientes para sincronização.' });
        }

        // --- SEGURANÇA: Verificação Horizontal para Professor (Prevenção IDOR) ---
        if (req.user && req.user.perfil === 'professor') {
            const allowed = req.allowedTurmas || [];
            if (!allowed.includes(turma)) {
                return res.status(403).json({ success: false, error: `Acesso negado. Você não tem permissão para sincronizar frequências para a turma ${turma}.` });
            }
        }
        // -------------------------------------------------------------------------

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
