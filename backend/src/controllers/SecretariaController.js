/**
 * SecretariaController — T3/T4/T5/T6
 * Endpoints para o perfil Secretaria: Alunos, Matrículas, Documentos,
 * Frequência, Calendário, Justificativas, Comunicados e Relatórios.
 */
const Aluno = require('../models/Aluno');
const Matricula = require('../models/Matricula');
const Turma = require('../models/Turma');
const Usuario = require('../models/Usuario');
const Comunicado = require('../models/Comunicado');
const Falta = require('../models/Falta');
const DocumentoEmitido = require('../models/DocumentoEmitido');
const JustificativaFalta = require('../models/JustificativaFalta');
const CalendarioEscolar = require('../models/CalendarioEscolar');
const AuditLog = require('../models/AuditLog');
const logger = require('../utils/logger');

// ─── Helper: registrar auditoria ─────────────────────────────────────────────
async function audit(req, acao, recurso, recursoId, detalhes = {}) {
    try {
        await AuditLog.create({
            usuarioId: req.user._id || req.user.id,
            usuarioNome: req.user.nome,
            usuarioEmail: req.user.email,
            perfil: req.user.perfil,
            acao,
            recurso,
            recursoId: recursoId?.toString(),
            detalhes: { descricao: detalhes.descricao, valorAnterior: detalhes.anterior, valorNovo: detalhes.novo },
            ip: req.ip,
            userAgent: req.get('User-Agent')
        });
    } catch (e) {
        logger.warn(`Audit log failed: ${e.message}`);
    }
}

// ─── Helper: gerar número de documento sequencial ────────────────────────────
async function gerarNumeroDocumento() {
    const ano = new Date().getFullYear();
    const count = await DocumentoEmitido.countDocuments({ createdAt: { $gte: new Date(`${ano}-01-01`) } });
    return `DOC-${ano}-${String(count + 1).padStart(6, '0')}`;
}

// ═══════════════════════════════════════════════════════════════════════════════
// T3 — ALUNOS & MATRÍCULAS & CADASTROS
// ═══════════════════════════════════════════════════════════════════════════════

// POST /api/secretaria/alunos — cadastrar aluno
exports.criarAluno = async (req, res) => {
    try {
        const dados = req.body;
        if (!dados.nome) {
            return res.status(400).json({ success: false, error: 'Nome do aluno é obrigatório.' });
        }

        const aluno = new Aluno(dados);
        await aluno.save();

        await audit(req, 'CREATE_STUDENT', 'Alunos', aluno._id, { descricao: `Aluno ${aluno.nome} cadastrado pela secretaria` });

        res.status(201).json({ success: true, data: aluno });
    } catch (error) {
        logger.error(`[Secretaria.criarAluno] ${error.message}`);
        res.status(500).json({ success: false, error: error.message });
    }
};

// PUT /api/secretaria/alunos/:id — editar aluno
exports.editarAluno = async (req, res) => {
    try {
        const aluno = await Aluno.findById(req.params.id);
        if (!aluno) return res.status(404).json({ success: false, error: 'Aluno não encontrado.' });

        const anterior = aluno.toObject();
        Object.assign(aluno, req.body);
        await aluno.save();

        await audit(req, 'UPDATE_STUDENT', 'Alunos', aluno._id, {
            descricao: `Aluno ${aluno.nome} atualizado`,
            anterior,
            novo: aluno.toObject()
        });

        res.json({ success: true, data: aluno });
    } catch (error) {
        logger.error(`[Secretaria.editarAluno] ${error.message}`);
        res.status(500).json({ success: false, error: error.message });
    }
};

// POST /api/secretaria/matriculas — nova matrícula
exports.criarMatricula = async (req, res) => {
    try {
        const { alunoId, turmaId, anoLetivo, numeroChamada, observacoes } = req.body;

        if (!alunoId || !turmaId || !anoLetivo) {
            return res.status(400).json({ success: false, error: 'alunoId, turmaId e anoLetivo são obrigatórios.' });
        }

        const aluno = await Aluno.findById(alunoId);
        if (!aluno) return res.status(404).json({ success: false, error: 'Aluno não encontrado.' });

        const turma = await Turma.findById(turmaId);
        if (!turma) return res.status(404).json({ success: false, error: 'Turma não encontrada.' });

        // Gerar número de matrícula
        const count = await Matricula.countDocuments({ anoLetivo });
        const matriculaNumero = `${anoLetivo}${String(count + 1).padStart(4, '0')}`;

        const matricula = new Matricula({
            alunoId,
            turmaId,
            anoLetivo,
            matriculaNumero,
            numeroChamada,
            observacoes,
            criadoPor: req.user._id || req.user.id
        });

        await matricula.save();

        // Atualiza o cache de turma no aluno
        aluno.turma = turma.nome || turma.id;
        aluno.turmaId = turmaId;
        await aluno.save();

        await audit(req, 'CREATE_ENROLLMENT', 'Matriculas', matricula._id, {
            descricao: `Matrícula ${matriculaNumero} criada para ${aluno.nome}`
        });

        res.status(201).json({ success: true, data: matricula });
    } catch (error) {
        if (error.code === 11000) {
            return res.status(409).json({ success: false, error: 'Aluno já matriculado neste ano letivo.' });
        }
        logger.error(`[Secretaria.criarMatricula] ${error.message}`);
        res.status(500).json({ success: false, error: error.message });
    }
};

// PUT /api/secretaria/matriculas/:id/transferir
exports.transferirMatricula = async (req, res) => {
    try {
        const { novaTurmaId, motivo } = req.body;
        const matricula = await Matricula.findById(req.params.id);
        if (!matricula) return res.status(404).json({ success: false, error: 'Matrícula não encontrada.' });

        const turmaAnterior = matricula.turmaId;
        matricula.turmaId = novaTurmaId;
        matricula.observacoes = `${matricula.observacoes || ''}\nTransferido: ${motivo || 'Sem motivo informado'} (${new Date().toLocaleDateString('pt-BR')})`;
        await matricula.save();

        // Atualiza cache no aluno
        const turma = await Turma.findById(novaTurmaId);
        if (turma) {
            await Aluno.findByIdAndUpdate(matricula.alunoId, { turma: turma.nome || turma.id, turmaId: novaTurmaId });
        }

        await audit(req, 'TRANSFER_ENROLLMENT', 'Matriculas', matricula._id, {
            descricao: `Transferência de turma ${turmaAnterior} → ${novaTurmaId}`,
            anterior: { turmaId: turmaAnterior },
            novo: { turmaId: novaTurmaId }
        });

        res.json({ success: true, data: matricula });
    } catch (error) {
        logger.error(`[Secretaria.transferirMatricula] ${error.message}`);
        res.status(500).json({ success: false, error: error.message });
    }
};

// PUT /api/secretaria/matriculas/:id/status
exports.atualizarStatusMatricula = async (req, res) => {
    try {
        const { status, motivoSaida } = req.body;
        const matricula = await Matricula.findById(req.params.id);
        if (!matricula) return res.status(404).json({ success: false, error: 'Matrícula não encontrada.' });

        const statusAnterior = matricula.status;
        matricula.status = status;

        if (['transferido', 'evadido'].includes(status)) {
            matricula.dataSaida = new Date();
            matricula.motivoSaida = motivoSaida || '';
        }

        await matricula.save();

        await audit(req, 'UPDATE_ENROLLMENT_STATUS', 'Matriculas', matricula._id, {
            descricao: `Status alterado de ${statusAnterior} → ${status}`,
            anterior: { status: statusAnterior },
            novo: { status }
        });

        res.json({ success: true, data: matricula });
    } catch (error) {
        logger.error(`[Secretaria.atualizarStatusMatricula] ${error.message}`);
        res.status(500).json({ success: false, error: error.message });
    }
};

// POST /api/secretaria/responsaveis — cadastro + vínculo
exports.criarResponsavel = async (req, res) => {
    try {
        const { nome, email, telefone, cpf, alunoId, parentesco } = req.body;

        if (!nome || !email || !telefone) {
            return res.status(400).json({ success: false, error: 'Nome, email e telefone são obrigatórios.' });
        }

        // Cria o usuário responsável
        let usuario = await Usuario.findOne({ email });
        if (!usuario) {
            usuario = new Usuario({
                nome,
                email,
                telefone,
                cpf,
                perfil: 'responsavel',
                parentesco,
                nomeAluno: ''
            });
            await usuario.save();
        }

        // Vincula ao aluno se informado
        if (alunoId) {
            const aluno = await Aluno.findById(alunoId);
            if (aluno) {
                if (!aluno.responsaveis) aluno.responsaveis = [];
                aluno.responsaveis.push({
                    nome,
                    tipo: parentesco || 'Responsável Legal',
                    parentesco,
                    cpf,
                    telefone,
                    email
                });
                aluno.responsavel = nome;
                usuario.nomeAluno = aluno.nome;
                await aluno.save();
                await usuario.save();
            }
        }

        await audit(req, 'CREATE_GUARDIAN', 'Usuarios', usuario._id, {
            descricao: `Responsável ${nome} cadastrado${alunoId ? ` e vinculado ao aluno ${alunoId}` : ''}`
        });

        res.status(201).json({ success: true, data: usuario });
    } catch (error) {
        if (error.code === 11000) {
            return res.status(409).json({ success: false, error: 'Email ou CPF já cadastrado.' });
        }
        logger.error(`[Secretaria.criarResponsavel] ${error.message}`);
        res.status(500).json({ success: false, error: error.message });
    }
};

// GET /api/secretaria/turmas — listagem
exports.listarTurmas = async (req, res) => {
    try {
        const turmas = await Turma.find({ ativo: true }).sort({ nome: 1 }).lean();

        // Conta alunos por turma
        const turmasComContagem = await Promise.all(turmas.map(async (t) => {
            const totalAlunos = await Aluno.countDocuments({
                $or: [{ turma: t.nome }, { turma: t.id }, { turmaId: t._id }],
                ativo: true
            });
            return { ...t, totalAlunos };
        }));

        res.json({ success: true, data: turmasComContagem });
    } catch (error) {
        logger.error(`[Secretaria.listarTurmas] ${error.message}`);
        res.status(500).json({ success: false, error: error.message });
    }
};

// ═══════════════════════════════════════════════════════════════════════════════
// T4 — DOCUMENTOS
// ═══════════════════════════════════════════════════════════════════════════════

// POST /api/secretaria/documentos/declaracao-matricula/:alunoId
exports.gerarDeclaracaoMatricula = async (req, res) => {
    try {
        const aluno = await Aluno.findById(req.params.alunoId).lean();
        if (!aluno) return res.status(404).json({ success: false, error: 'Aluno não encontrado.' });

        const matricula = await Matricula.findOne({ alunoId: req.params.alunoId, status: 'cursando' }).lean();

        const turma = aluno.turma || (matricula ? matricula.turmaId : 'N/A');
        const anoLetivo = matricula ? matricula.anoLetivo : new Date().getFullYear();
        const numDoc = await gerarNumeroDocumento();

        const conteudoHTML = `
            <h2 style="text-align:center">DECLARAÇÃO DE MATRÍCULA</h2>
            <p>Declaramos, para os devidos fins, que <strong>${aluno.nome}${aluno.sobrenome ? ' ' + aluno.sobrenome : ''}</strong>,
            encontra-se devidamente matriculado(a) nesta instituição de ensino,
            na turma <strong>${turma}</strong>, referente ao ano letivo de <strong>${anoLetivo}</strong>.</p>
            ${matricula ? `<p>Número de matrícula: <strong>${matricula.matriculaNumero || 'N/A'}</strong></p>` : ''}
            <p>Por ser expressão da verdade, firmamos a presente declaração.</p>
            <p style="margin-top:40px;">Data: ${new Date().toLocaleDateString('pt-BR')}</p>
            <p style="margin-top:60px;">____________________________________<br/>Secretaria Escolar</p>
        `;

        const doc = new DocumentoEmitido({
            alunoId: aluno._id,
            alunoNome: aluno.nome,
            tipo: 'declaracao_matricula',
            titulo: `Declaração de Matrícula - ${aluno.nome}`,
            numeroDocumento: numDoc,
            anoLetivo,
            arquivo: { nome: `declaracao_matricula_${aluno._id}.html`, mimeType: 'text/html' },
            emitidoPor: req.user._id || req.user.id,
            emitidoPorNome: req.user.nome
        });

        await doc.save();

        await audit(req, 'GENERATE_DOCUMENT', 'Documentos', doc._id, {
            descricao: `Declaração de matrícula gerada para ${aluno.nome}`
        });

        res.status(201).json({ success: true, data: { documento: doc, conteudoHTML } });
    } catch (error) {
        logger.error(`[Secretaria.gerarDeclaracaoMatricula] ${error.message}`);
        res.status(500).json({ success: false, error: error.message });
    }
};

// POST /api/secretaria/documentos/declaracao-frequencia/:alunoId
exports.gerarDeclaracaoFrequencia = async (req, res) => {
    try {
        const aluno = await Aluno.findById(req.params.alunoId).lean();
        if (!aluno) return res.status(404).json({ success: false, error: 'Aluno não encontrado.' });

        const totalFaltas = await Falta.countDocuments({ aluno: req.params.alunoId, presente: false });
        const totalPresencas = await Falta.countDocuments({ aluno: req.params.alunoId, presente: true });
        const totalRegistros = totalFaltas + totalPresencas;
        const percentual = totalRegistros > 0 ? ((totalPresencas / totalRegistros) * 100).toFixed(1) : 'N/A';
        const numDoc = await gerarNumeroDocumento();

        const conteudoHTML = `
            <h2 style="text-align:center">DECLARAÇÃO DE FREQUÊNCIA</h2>
            <p>Declaramos que o(a) aluno(a) <strong>${aluno.nome}${aluno.sobrenome ? ' ' + aluno.sobrenome : ''}</strong>,
            turma <strong>${aluno.turma || 'N/A'}</strong>, possui a seguinte frequência escolar:</p>
            <ul>
                <li>Total de registros: <strong>${totalRegistros}</strong></li>
                <li>Presenças: <strong>${totalPresencas}</strong></li>
                <li>Faltas: <strong>${totalFaltas}</strong></li>
                <li>Percentual de frequência: <strong>${percentual}%</strong></li>
            </ul>
            <p style="margin-top:40px;">Data: ${new Date().toLocaleDateString('pt-BR')}</p>
            <p style="margin-top:60px;">____________________________________<br/>Secretaria Escolar</p>
        `;

        const doc = new DocumentoEmitido({
            alunoId: aluno._id,
            alunoNome: aluno.nome,
            tipo: 'declaracao_frequencia',
            titulo: `Declaração de Frequência - ${aluno.nome}`,
            numeroDocumento: numDoc,
            anoLetivo: new Date().getFullYear(),
            arquivo: { nome: `declaracao_frequencia_${aluno._id}.html`, mimeType: 'text/html' },
            emitidoPor: req.user._id || req.user.id,
            emitidoPorNome: req.user.nome
        });

        await doc.save();

        await audit(req, 'GENERATE_DOCUMENT', 'Documentos', doc._id, {
            descricao: `Declaração de frequência gerada para ${aluno.nome}`
        });

        res.status(201).json({ success: true, data: { documento: doc, conteudoHTML } });
    } catch (error) {
        logger.error(`[Secretaria.gerarDeclaracaoFrequencia] ${error.message}`);
        res.status(500).json({ success: false, error: error.message });
    }
};

// POST /api/secretaria/documentos/historico-escolar/:alunoId
exports.gerarHistoricoEscolar = async (req, res) => {
    try {
        const aluno = await Aluno.findById(req.params.alunoId).lean();
        if (!aluno) return res.status(404).json({ success: false, error: 'Aluno não encontrado.' });

        const matriculas = await Matricula.find({ alunoId: req.params.alunoId }).sort({ anoLetivo: 1 }).lean();
        const numDoc = await gerarNumeroDocumento();

        let historicoRows = '';
        for (const m of matriculas) {
            const turma = await Turma.findById(m.turmaId).lean();
            historicoRows += `<tr>
                <td>${m.anoLetivo}</td>
                <td>${turma ? turma.nome : m.turmaId}</td>
                <td>${m.matriculaNumero || 'N/A'}</td>
                <td>${m.status}</td>
            </tr>`;
        }

        const conteudoHTML = `
            <h2 style="text-align:center">HISTÓRICO ESCOLAR</h2>
            <p><strong>Aluno(a):</strong> ${aluno.nome}${aluno.sobrenome ? ' ' + aluno.sobrenome : ''}</p>
            <p><strong>RA:</strong> ${aluno.matricula || 'N/A'}</p>
            <p><strong>Data de Nascimento:</strong> ${aluno.nascimento ? new Date(aluno.nascimento).toLocaleDateString('pt-BR') : 'N/A'}</p>
            <table border="1" cellpadding="8" cellspacing="0" style="width:100%; border-collapse: collapse; margin-top: 20px;">
                <thead><tr><th>Ano Letivo</th><th>Turma</th><th>Matrícula</th><th>Status</th></tr></thead>
                <tbody>${historicoRows || '<tr><td colspan="4">Nenhuma matrícula encontrada</td></tr>'}</tbody>
            </table>
            <p style="margin-top:40px;">Data: ${new Date().toLocaleDateString('pt-BR')}</p>
            <p style="margin-top:60px;">____________________________________<br/>Secretaria Escolar</p>
        `;

        const doc = new DocumentoEmitido({
            alunoId: aluno._id,
            alunoNome: aluno.nome,
            tipo: 'historico_escolar',
            titulo: `Histórico Escolar - ${aluno.nome}`,
            numeroDocumento: numDoc,
            arquivo: { nome: `historico_escolar_${aluno._id}.html`, mimeType: 'text/html' },
            emitidoPor: req.user._id || req.user.id,
            emitidoPorNome: req.user.nome
        });

        await doc.save();

        await audit(req, 'GENERATE_DOCUMENT', 'Documentos', doc._id, {
            descricao: `Histórico escolar gerado para ${aluno.nome}`
        });

        res.status(201).json({ success: true, data: { documento: doc, conteudoHTML } });
    } catch (error) {
        logger.error(`[Secretaria.gerarHistoricoEscolar] ${error.message}`);
        res.status(500).json({ success: false, error: error.message });
    }
};

// GET /api/secretaria/documentos/historico/:alunoId
exports.listarDocumentosAluno = async (req, res) => {
    try {
        const docs = await DocumentoEmitido.find({ alunoId: req.params.alunoId })
            .sort({ createdAt: -1 }).lean();

        res.json({ success: true, data: docs });
    } catch (error) {
        logger.error(`[Secretaria.listarDocumentosAluno] ${error.message}`);
        res.status(500).json({ success: false, error: error.message });
    }
};

// POST /api/secretaria/alunos/:id/documentos-upload
exports.uploadDocumentoAluno = async (req, res) => {
    try {
        const aluno = await Aluno.findById(req.params.id);
        if (!aluno) return res.status(404).json({ success: false, error: 'Aluno não encontrado.' });

        const { nomeArquivo, base64, tipo } = req.body;
        if (!nomeArquivo || !base64) {
            return res.status(400).json({ success: false, error: 'nomeArquivo e base64 são obrigatórios.' });
        }

        if (!aluno.documentos) aluno.documentos = [];
        const docEntry = {
            id: new (require('mongoose').Types.ObjectId)().toString(),
            nome: nomeArquivo,
            tipo: tipo || 'outros',
            base64,
            enviadoEm: new Date()
        };

        if (Array.isArray(aluno.documentos)) {
            aluno.documentos.push(docEntry);
        } else {
            aluno.documentos = [docEntry];
        }

        await aluno.save();

        await audit(req, 'UPLOAD_DOCUMENT', 'Alunos', aluno._id, {
            descricao: `Documento '${nomeArquivo}' enviado para ${aluno.nome}`
        });

        res.status(201).json({ success: true, data: docEntry });
    } catch (error) {
        logger.error(`[Secretaria.uploadDocumentoAluno] ${error.message}`);
        res.status(500).json({ success: false, error: error.message });
    }
};

// ═══════════════════════════════════════════════════════════════════════════════
// T5 — FREQUÊNCIA, CALENDÁRIO, JUSTIFICATIVAS
// ═══════════════════════════════════════════════════════════════════════════════

// GET /api/secretaria/frequencia/consolidada
exports.frequenciaConsolidada = async (req, res) => {
    try {
        const { turma, dataInicio, dataFim } = req.query;

        let matchQuery = {};
        if (turma) matchQuery.turma = turma;
        if (dataInicio || dataFim) {
            matchQuery.data = {};
            if (dataInicio) matchQuery.data.$gte = new Date(dataInicio);
            if (dataFim) matchQuery.data.$lte = new Date(dataFim);
        }

        const resultado = await Falta.aggregate([
            { $match: matchQuery },
            {
                $group: {
                    _id: '$aluno',
                    totalRegistros: { $sum: 1 },
                    presencas: { $sum: { $cond: ['$presente', 1, 0] } },
                    faltas: { $sum: { $cond: ['$presente', 0, 1] } },
                    faltasJustificadas: { $sum: { $cond: [{ $and: [{ $not: '$presente' }, '$justificada'] }, 1, 0] } }
                }
            },
            { $sort: { faltas: -1 } }
        ]);

        // Popula nomes dos alunos
        const alunoIds = resultado.map(r => r._id);
        const alunos = await Aluno.find({ _id: { $in: alunoIds } }).select('nome turma').lean();
        const alunosMap = {};
        alunos.forEach(a => { alunosMap[a._id.toString()] = a; });

        const dados = resultado.map(r => {
            const al = alunosMap[r._id?.toString()] || {};
            const total = r.totalRegistros || 1;
            return {
                alunoId: r._id,
                alunoNome: al.nome || 'Desconhecido',
                turma: al.turma || 'N/A',
                totalRegistros: r.totalRegistros,
                presencas: r.presencas,
                faltas: r.faltas,
                faltasJustificadas: r.faltasJustificadas,
                percentualFrequencia: ((r.presencas / total) * 100).toFixed(1)
            };
        });

        res.json({ success: true, data: dados });
    } catch (error) {
        logger.error(`[Secretaria.frequenciaConsolidada] ${error.message}`);
        res.status(500).json({ success: false, error: error.message });
    }
};

// GET /api/secretaria/calendario
exports.listarCalendario = async (req, res) => {
    try {
        const { anoLetivo } = req.query;
        const query = { ativo: true };
        if (anoLetivo) query.anoLetivo = parseInt(anoLetivo);

        const eventos = await CalendarioEscolar.find(query).sort({ dataInicio: 1 }).lean();
        res.json({ success: true, data: eventos });
    } catch (error) {
        logger.error(`[Secretaria.listarCalendario] ${error.message}`);
        res.status(500).json({ success: false, error: error.message });
    }
};

// POST /api/secretaria/calendario
exports.criarEventoCalendario = async (req, res) => {
    try {
        const { titulo, descricao, dataInicio, dataFim, tipo, anoLetivo, abrangencia, turmasIds, cor } = req.body;

        if (!titulo || !dataInicio || !dataFim || !tipo) {
            return res.status(400).json({ success: false, error: 'titulo, dataInicio, dataFim e tipo são obrigatórios.' });
        }

        const evento = new CalendarioEscolar({
            titulo,
            descricao,
            dataInicio: new Date(dataInicio),
            dataFim: new Date(dataFim),
            tipo,
            anoLetivo: anoLetivo || new Date().getFullYear(),
            abrangencia: abrangencia || 'escola',
            turmasIds: turmasIds || [],
            cor: cor || '#4A90D9',
            criadoPor: req.user._id || req.user.id,
            criadoPorNome: req.user.nome
        });

        await evento.save();

        await audit(req, 'CREATE_CALENDAR_EVENT', 'Calendario', evento._id, {
            descricao: `Evento '${titulo}' criado no calendário`
        });

        res.status(201).json({ success: true, data: evento });
    } catch (error) {
        logger.error(`[Secretaria.criarEventoCalendario] ${error.message}`);
        res.status(500).json({ success: false, error: error.message });
    }
};

// GET /api/secretaria/justificativas
exports.listarJustificativas = async (req, res) => {
    try {
        const { status, alunoId } = req.query;
        const query = {};
        if (status) query.status = status;
        if (alunoId) query.alunoId = alunoId;

        const justificativas = await JustificativaFalta.find(query).sort({ createdAt: -1 }).lean();
        res.json({ success: true, data: justificativas });
    } catch (error) {
        logger.error(`[Secretaria.listarJustificativas] ${error.message}`);
        res.status(500).json({ success: false, error: error.message });
    }
};

// PUT /api/secretaria/justificativas/:id — aprovar/rejeitar
exports.analisarJustificativa = async (req, res) => {
    try {
        const { status, motivoRejeicao } = req.body;

        if (!['aprovada', 'rejeitada'].includes(status)) {
            return res.status(400).json({ success: false, error: 'Status deve ser "aprovada" ou "rejeitada".' });
        }

        const justificativa = await JustificativaFalta.findById(req.params.id);
        if (!justificativa) return res.status(404).json({ success: false, error: 'Justificativa não encontrada.' });

        justificativa.status = status;
        justificativa.analisadoPor = req.user._id || req.user.id;
        justificativa.analisadoPorNome = req.user.nome;
        justificativa.dataAnalise = new Date();
        if (status === 'rejeitada') justificativa.motivoRejeicao = motivoRejeicao || '';

        await justificativa.save();

        // Se aprovada, marca as faltas do período como justificadas
        if (status === 'aprovada') {
            await Falta.updateMany(
                {
                    aluno: justificativa.alunoId,
                    data: { $gte: justificativa.dataInicio, $lte: justificativa.dataFim },
                    presente: false
                },
                { $set: { justificada: true, motivo: justificativa.motivo } }
            );
        }

        await audit(req, 'REVIEW_JUSTIFICATION', 'Justificativas', justificativa._id, {
            descricao: `Justificativa ${status} para ${justificativa.alunoNome}`
        });

        res.json({ success: true, data: justificativa });
    } catch (error) {
        logger.error(`[Secretaria.analisarJustificativa] ${error.message}`);
        res.status(500).json({ success: false, error: error.message });
    }
};

// ═══════════════════════════════════════════════════════════════════════════════
// T6 — COMUNICAÇÃO & RELATÓRIOS
// ═══════════════════════════════════════════════════════════════════════════════

// POST /api/secretaria/comunicados
exports.criarComunicado = async (req, res) => {
    try {
        const { titulo, conteudo, destinatarios, categoria, prioridade } = req.body;

        if (!titulo || !conteudo || !destinatarios || destinatarios.length === 0) {
            return res.status(400).json({ success: false, error: 'Título, conteúdo e destinatários são obrigatórios.' });
        }

        const userId = req.user._id || req.user.id;

        const comunicado = new Comunicado({
            titulo,
            conteudo,
            autorId: userId,
            autorNome: req.user.nome,
            autorPerfil: 'secretaria',
            // Campos legado para compatibilidade
            diretorId: userId,
            diretorNome: req.user.nome,
            diretorPerfil: 'Secretaria',
            destinatarios,
            categoria: categoria || 'Secretaria',
            prioridade: prioridade || 'Normal'
        });

        await comunicado.save();

        if (global.io) {
            global.io.emit('comunicado:new', comunicado.toObject());
        }

        await audit(req, 'CREATE_ANNOUNCEMENT', 'Comunicados', comunicado._id, {
            descricao: `Comunicado '${titulo}' criado pela secretaria`
        });

        res.status(201).json({ success: true, data: comunicado });
    } catch (error) {
        logger.error(`[Secretaria.criarComunicado] ${error.message}`);
        res.status(500).json({ success: false, error: error.message });
    }
};

// GET /api/secretaria/comunicados
exports.listarComunicados = async (req, res) => {
    try {
        const comunicados = await Comunicado.find({ ativo: true })
            .sort({ dataCriacao: -1 })
            .lean();

        res.json({ success: true, data: comunicados });
    } catch (error) {
        logger.error(`[Secretaria.listarComunicados] ${error.message}`);
        res.status(500).json({ success: false, error: error.message });
    }
};

// GET /api/secretaria/relatorios/alunos-por-turma
exports.relatorioAlunosPorTurma = async (req, res) => {
    try {
        const turmas = await Turma.find({ ativo: true }).sort({ nome: 1 }).lean();

        const resultado = await Promise.all(turmas.map(async (t) => {
            const alunos = await Aluno.find({
                $or: [{ turma: t.nome }, { turma: t.id }, { turmaId: t._id }],
                ativo: true
            }).select('nome sobrenome matricula turma ativo').sort({ nome: 1 }).lean();

            return {
                turma: t.nome || t.id,
                turmaId: t._id,
                totalAlunos: alunos.length,
                alunos
            };
        }));

        res.json({ success: true, data: resultado });
    } catch (error) {
        logger.error(`[Secretaria.relatorioAlunosPorTurma] ${error.message}`);
        res.status(500).json({ success: false, error: error.message });
    }
};

// GET /api/secretaria/relatorios/matriculas
exports.relatorioMatriculas = async (req, res) => {
    try {
        const { anoLetivo, status } = req.query;
        const query = {};
        if (anoLetivo) query.anoLetivo = parseInt(anoLetivo);
        if (status) query.status = status;

        const matriculas = await Matricula.find(query).sort({ createdAt: -1 }).lean();

        // Popula nomes
        const alunoIds = [...new Set(matriculas.map(m => m.alunoId))];
        const alunos = await Aluno.find({ _id: { $in: alunoIds } }).select('nome sobrenome').lean();
        const alunosMap = {};
        alunos.forEach(a => { alunosMap[a._id.toString()] = a; });

        const dados = matriculas.map(m => {
            const al = alunosMap[m.alunoId?.toString()] || {};
            return {
                ...m,
                alunoNome: al.nome || 'Desconhecido',
                alunoSobrenome: al.sobrenome || ''
            };
        });

        // Resumo
        const resumo = {
            total: dados.length,
            cursando: dados.filter(d => d.status === 'cursando').length,
            aprovado: dados.filter(d => d.status === 'aprovado').length,
            reprovado: dados.filter(d => d.status === 'reprovado').length,
            transferido: dados.filter(d => d.status === 'transferido').length,
            evadido: dados.filter(d => d.status === 'evadido').length
        };

        res.json({ success: true, data: { matriculas: dados, resumo } });
    } catch (error) {
        logger.error(`[Secretaria.relatorioMatriculas] ${error.message}`);
        res.status(500).json({ success: false, error: error.message });
    }
};

// GET /api/secretaria/relatorios/exportar
exports.exportarRelatorio = async (req, res) => {
    try {
        const { tipo } = req.query; // 'alunos', 'matriculas', 'frequencia'

        let dados = [];
        let headers = [];

        if (tipo === 'alunos') {
            dados = await Aluno.find({ ativo: true }).select('nome sobrenome turma matricula nascimento telefone responsavel').sort({ nome: 1 }).lean();
            headers = ['Nome', 'Sobrenome', 'Turma', 'Matrícula', 'Nascimento', 'Telefone', 'Responsável'];
        } else if (tipo === 'matriculas') {
            const matriculas = await Matricula.find({}).sort({ anoLetivo: -1, createdAt: -1 }).lean();
            const alunoIds = [...new Set(matriculas.map(m => m.alunoId))];
            const alunos = await Aluno.find({ _id: { $in: alunoIds } }).select('nome').lean();
            const map = {};
            alunos.forEach(a => { map[a._id.toString()] = a.nome; });
            dados = matriculas.map(m => ({
                alunoNome: map[m.alunoId?.toString()] || 'N/A',
                matriculaNumero: m.matriculaNumero,
                anoLetivo: m.anoLetivo,
                status: m.status,
                dataMatricula: m.dataMatricula ? new Date(m.dataMatricula).toLocaleDateString('pt-BR') : ''
            }));
            headers = ['Aluno', 'Nº Matrícula', 'Ano Letivo', 'Status', 'Data Matrícula'];
        } else {
            return res.status(400).json({ success: false, error: 'Tipo de relatório inválido. Use: alunos, matriculas' });
        }

        // Gerar CSV
        const csvRows = [headers.join(';')];
        dados.forEach(d => {
            const values = Object.values(d).map(v => {
                if (v instanceof Date) return v.toLocaleDateString('pt-BR');
                return String(v || '').replace(/;/g, ',');
            });
            csvRows.push(values.join(';'));
        });

        const csv = csvRows.join('\n');

        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename=relatorio_${tipo}_${Date.now()}.csv`);
        res.send('\uFEFF' + csv); // BOM for Excel UTF-8 compatibility
    } catch (error) {
        logger.error(`[Secretaria.exportarRelatorio] ${error.message}`);
        res.status(500).json({ success: false, error: error.message });
    }
};

// GET /api/secretaria/dashboard/resumo — estatísticas para o dashboard
exports.dashboardResumo = async (req, res) => {
    try {
        const [totalAlunos, totalTurmas, totalMatriculas, justificativasPendentes, docsEmitidos] = await Promise.all([
            Aluno.countDocuments({ ativo: true }),
            Turma.countDocuments({ ativo: true }),
            Matricula.countDocuments({ status: 'cursando' }),
            JustificativaFalta.countDocuments({ status: 'pendente' }),
            DocumentoEmitido.countDocuments({ createdAt: { $gte: new Date(new Date().getFullYear(), 0, 1) } })
        ]);

        res.json({
            success: true,
            data: {
                totalAlunos,
                totalTurmas,
                totalMatriculas,
                justificativasPendentes,
                docsEmitidos
            }
        });
    } catch (error) {
        logger.error(`[Secretaria.dashboardResumo] ${error.message}`);
        res.status(500).json({ success: false, error: error.message });
    }
};
