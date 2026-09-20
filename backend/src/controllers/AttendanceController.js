const Falta = require('../models/Falta');
const Aluno = require('../models/Aluno');
const assertAcessoAoAluno = require('../middleware/assertAcessoAoAluno');
const { projetarAluno } = require('../utils/projecaoAluno');

// O que o cliente pode gravar num registro de chamada (Issue #397). `escolaId`
// não está aqui de propósito: ele vem do contexto da sessão, nunca do corpo —
// senão uma chamada pode nascer dentro do tenant de outra escola.
const CAMPOS_FALTA = [
    'aluno',
    'matriculaId',
    'turma',
    'data',
    'materia',
    'presente',
    'justificada',
    'motivo',
];

/**
 * O `populate('aluno')` traria o cadastro inteiro da criança em cada registro
 * de chamada. Aqui o aluno passa pela mesma projeção por perfil das rotas de
 * aluno (Issue #388).
 */
function comAlunoProjetado(doc, perfil) {
    const obj = typeof doc.toObject === 'function' ? doc.toObject({ flattenMaps: true }) : doc;
    if (obj.aluno && typeof obj.aluno === 'object') obj.aluno = projetarAluno(obj.aluno, perfil);
    return obj;
}
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
                    return res.status(403).json({
                        success: false,
                        error: 'Acesso negado. Você não tem permissão para visualizar faltas desta turma.',
                    });
                }
            } else {
                query.turma = { $in: allowed };
            }
        }
        // -------------------------------------------------------------------------

        const docs = await Falta.find(query).populate('aluno');
        res.json({
            success: true,
            data: docs.map((d) => comAlunoProjetado(d, req.user?.perfil)),
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};

exports.create = async (req, res) => {
    try {
        const { turma } = req.body;
        const corpo = {};
        for (const campo of CAMPOS_FALTA) {
            if (req.body[campo] !== undefined) corpo[campo] = req.body[campo];
        }
        // --- SEGURANÇA: Verificação Horizontal para Professor (Prevenção IDOR) ---
        if (req.user && req.user.perfil === 'professor') {
            const allowed = req.allowedTurmas || [];
            if (!turma || !allowed.includes(turma)) {
                return res.status(403).json({
                    success: false,
                    error: 'Acesso negado. Você não tem permissão para registrar faltas para esta turma.',
                });
            }
        }
        // -------------------------------------------------------------------------

        // O aluno da chamada passa pela mesma guarda das rotas de aluno: sem
        // ela, dava para lançar falta no nome de criança de outra turma.
        if (corpo.aluno) {
            const acesso = await assertAcessoAoAluno(req, String(corpo.aluno));
            if (!acesso.ok) {
                return res.status(acesso.status).json({ success: false, error: acesso.error });
            }
        }

        if (req.escolaId) corpo.escolaId = req.escolaId;
        const doc = await Falta.create(corpo);
        res.status(201).json({ success: true, data: doc });
    } catch (e) {
        res.status(400).json({ success: false, error: e.message });
    }
};

exports.get = async (req, res) => {
    try {
        const doc = await Falta.findById(req.params.id).populate('aluno');
        if (!doc)
            return res.status(404).json({ success: false, error: 'Registro não encontrado.' });

        // --- SEGURANÇA: Verificação Horizontal para Professor (Prevenção IDOR) ---
        if (req.user && req.user.perfil === 'professor') {
            const allowed = req.allowedTurmas || [];
            if (!allowed.includes(doc.turma)) {
                return res.status(403).json({
                    success: false,
                    error: 'Acesso negado. Você não tem permissão para acessar este registro.',
                });
            }
        }
        // -------------------------------------------------------------------------

        res.json({ success: true, data: comAlunoProjetado(doc, req.user?.perfil) });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
};

exports.update = async (req, res) => {
    try {
        const doc = await Falta.findById(req.params.id);
        if (!doc)
            return res.status(404).json({ success: false, error: 'Registro não encontrado.' });

        // --- SEGURANÇA: Verificação Horizontal para Professor (Prevenção IDOR) ---
        if (req.user && req.user.perfil === 'professor') {
            const allowed = req.allowedTurmas || [];
            if (!allowed.includes(doc.turma)) {
                return res.status(403).json({
                    success: false,
                    error: 'Acesso negado. Você não tem permissão para modificar este registro.',
                });
            }
            if (req.body.turma && !allowed.includes(req.body.turma)) {
                return res.status(403).json({
                    success: false,
                    error: 'Acesso negado. Você não pode mover registros para esta turma.',
                });
            }
        }
        // -------------------------------------------------------------------------

        const updatedDoc = await Falta.findByIdAndUpdate(req.params.id, req.body, { new: true });
        res.json({ success: true, data: updatedDoc });
    } catch (e) {
        res.status(400).json({ success: false, error: e.message });
    }
};

exports.delete = async (req, res) => {
    try {
        const doc = await Falta.findById(req.params.id);
        if (!doc)
            return res.status(404).json({ success: false, error: 'Registro não encontrado.' });

        // --- SEGURANÇA: Verificação Horizontal para Professor (Prevenção IDOR) ---
        if (req.user && req.user.perfil === 'professor') {
            const allowed = req.allowedTurmas || [];
            if (!allowed.includes(doc.turma)) {
                return res.status(403).json({
                    success: false,
                    error: 'Acesso negado. Você não tem permissão para deletar este registro.',
                });
            }
        }
        // -------------------------------------------------------------------------

        await Falta.findByIdAndDelete(req.params.id);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
};

exports.sync = async (req, res) => {
    try {
        const { turma, data, materia, presencas } = req.body; // presencas: [{ alunoId, presente }]

        if (!turma || !data || !materia || !Array.isArray(presencas)) {
            return res
                .status(400)
                .json({ success: false, error: 'Dados insuficientes para sincronização.' });
        }

        // --- SEGURANÇA: Verificação Horizontal para Professor (Prevenção IDOR) ---
        if (req.user && req.user.perfil === 'professor') {
            const allowed = req.allowedTurmas || [];
            if (!allowed.includes(turma)) {
                return res.status(403).json({
                    success: false,
                    error: `Acesso negado. Você não tem permissão para sincronizar frequências para a turma ${turma}.`,
                });
            }
        }
        // -------------------------------------------------------------------------

        const dataBusca = new Date(data);
        const start = new Date(dataBusca);
        start.setHours(0, 0, 0, 0);
        const end = new Date(dataBusca);
        end.setHours(23, 59, 59, 999);

        // 1. Remove registros antigos desse dia/turma/materia para evitar duplicatas
        //
        // O `escolaId` NÃO é opcional neste filtro. Sem ele, a chave
        // (turma, materia, data) é compartilhada entre escolas da mesma rede:
        // duas unidades com uma turma "1A" e a matéria "Sala Principal"
        // colidem, e sincronizar a chamada de uma APAGAVA a da outra —
        // silenciosamente, todo dia, sem erro nenhum. O insert logo abaixo
        // sempre gravou o escolaId certo; era só o delete que varria a rede.
        //
        // Registros legados (gravados antes do multi-escola, sem escolaId) são
        // apagados junto quando a requisição tem escola: eles são exatamente os
        // que a nova gravação vem substituir para aquela turma. Sem escola
        // resolvida, o filtro se limita ao legado — nunca toca no que já
        // pertence a uma escola identificada.
        const filtroLimpeza = {
            turma,
            materia,
            data: { $gte: start, $lte: end },
        };
        filtroLimpeza.escolaId = req.escolaId
            ? { $in: [String(req.escolaId), null, ''] }
            : { $in: [null, ''] };

        await Falta.deleteMany(filtroLimpeza);

        // Todo aluno da lista precisa ser da turma (e da escola) da chamada.
        // Sem esta conferência, uma sincronização podia gravar presença e falta
        // no nome de criança de outra turma — dado escolar de terceiro.
        const idsInformados = [...new Set(presencas.map((p) => String(p.alunoId)).filter(Boolean))];
        if (idsInformados.length > 0) {
            const grafias = [turma, String(turma).replace('º', '')];
            const daTurma = await Aluno.find({
                $and: [
                    { $or: [{ _id: { $in: idsInformados } }, { id: { $in: idsInformados } }] },
                    { $or: [{ turma: { $in: grafias } }, { turmaId: { $in: grafias } }] },
                    ...(req.escolaId ? [{ escolaId: String(req.escolaId) }] : []),
                ],
            })
                .select('_id id')
                .lean();

            const conhecidos = new Set(
                daTurma.flatMap((a) => [String(a._id), a.id ? String(a.id) : null].filter(Boolean))
            );
            const forasteiros = idsInformados.filter((id) => !conhecidos.has(id));
            if (forasteiros.length > 0) {
                return res.status(403).json({
                    success: false,
                    codigo: 'ALUNO_FORA_DA_TURMA',
                    error: `A lista tem ${forasteiros.length} aluno(s) que não pertencem à turma ${turma}.`,
                });
            }
        }

        // 2. Prepara novos documentos
        const docs = presencas.map((p) => ({
            aluno: p.alunoId,
            turma,
            data: dataBusca,
            materia,
            presente: p.presente,
            // `justificada` nasce explicitamente false: deixá-lo `undefined`
            // fazia a consulta `{ justificada: false }` do relatório de
            // frequência não casar com nenhuma falta gravada.
            justificada: false,
            escolaId: req.escolaId || undefined,
        }));

        // 3. Insere em massa
        const result = await Falta.insertMany(docs);

        // Registro de Auditoria
        await AuditoriaService.log({
            req,
            acao: 'SYNC_ATTENDANCE',
            recurso: `Turma: ${turma}`,
            detalhes: { data: dataBusca, materia, totalAlunos: result.length },
        });

        res.json({
            success: true,
            count: result.length,
            message: 'Frequência dos alunos sincronizada com sucesso.',
        });
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
        const φ1 = (lat * Math.PI) / 180;
        const φ2 = (ESCOLA_LAT * Math.PI) / 180;
        const Δφ = ((ESCOLA_LAT - lat) * Math.PI) / 180;
        const Δλ = ((ESCOLA_LON - lon) * Math.PI) / 180;

        const a =
            Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
            Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        const distancia = R * c;

        const dentroDoRaio = distancia <= RAIO_MAX_METROS;

        if (!dentroDoRaio) {
            return res.json({
                success: false,
                error: 'Você está fora do perímetro escolar.',
                distancia: Math.round(distancia),
            });
        }

        // Se estiver dentro, registra log e permite marcar presença
        await AuditoriaService.log({
            req,
            acao: 'GEOFENCE_VALIDATED',
            recurso: `Aluno: ${alunoId}`,
            detalhes: { lat, lon, distancia: Math.round(distancia) },
        });

        res.json({ success: true, message: 'Localização validada com sucesso!' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};
