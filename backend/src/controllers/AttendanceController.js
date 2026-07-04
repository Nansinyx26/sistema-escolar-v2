const Falta = require('../models/Falta');
const AuditoriaService = require('../services/AuditoriaService');

exports.list = async (req, res) => {
    try {
        const { turma, data } = req.query;
        const query = {};
        // Multi-escola: isola por tenant quando o contexto está resolvido
        if (req.escolaId) query.escolaId = req.escolaId;
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

        if (req.escolaId && !req.body.escolaId) req.body.escolaId = req.escolaId;
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
            presente: p.presente,
            escolaId: req.escolaId || undefined
        }));

        // 3. Insere em massa
        const result = await Falta.insertMany(docs);

        // Registro de Auditoria
        await AuditoriaService.log({
            req,
            acao: 'SYNC_ATTENDANCE',
            recurso: `Turma: ${turma}`,
            detalhes: { data: dataBusca, materia, totalAlunos: result.length }
        });

        res.json({ success: true, count: result.length, message: 'Frequência dos alunos sincronizada com sucesso.' });
    } catch (error) {
        console.error('Erro na sincronização de faltas:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};

/**
 * Validação de Geofencing (Fase 3: Mobilidade)
 * Verifica se o usuário está dentro de um raio de 500m da escola
 */
exports.validarPresenca = async (req, res) => {
    try {
        const { lat, lon, alunoId } = req.body;
        
        // Coordenadas da Sede (Exemplo: Centro de SP)
        const ESCOLA_LAT = -23.5505;
        const ESCOLA_LON = -46.6333;
        const RAIO_MAX_METROS = 500;

        if (!lat || !lon) {
            return res.status(400).json({ success: false, error: 'Coordenadas não fornecidas.' });
        }

        // Cálculo de Haversine
        const R = 6371e3; // Metros
        const φ1 = lat * Math.PI/180;
        const φ2 = ESCOLA_LAT * Math.PI/180;
        const Δφ = (ESCOLA_LAT-lat) * Math.PI/180;
        const Δλ = (ESCOLA_LON-lon) * Math.PI/180;

        const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) +
                  Math.cos(φ1) * Math.cos(φ2) *
                  Math.sin(Δλ/2) * Math.sin(Δλ/2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
        const distancia = R * c;

        const dentroDoRaio = distancia <= RAIO_MAX_METROS;

        if (!dentroDoRaio) {
            return res.json({ 
                success: false, 
                error: 'Você está fora do perímetro escolar.',
                distancia: Math.round(distancia) 
            });
        }

        // Se estiver dentro, registra log e permite marcar presença
        await AuditoriaService.log({
            req,
            acao: 'GEOFENCE_VALIDATED',
            recurso: `Aluno: ${alunoId}`,
            detalhes: { lat, lon, distancia: Math.round(distancia) }
        });

        res.json({ success: true, message: 'Localização validada com sucesso!' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};
