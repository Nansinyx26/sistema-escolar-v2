/**
 * controllers/ResponsavelController.js
 * Controller dedicado ao Portal do Responsável.
 * Expõe endpoints para o responsável consultar dados do aluno vinculado
 * ao e-mail cadastrado no campo `responsavel` do modelo Aluno.
 *
 * Rotas criadas:
 *   GET /api/responsavel/aluno          → dados do aluno vinculado ao e-mail do responsável
 *   GET /api/responsavel/notas/:alunoId → boletim completo (matérias × bimestres)
 *   GET /api/responsavel/frequencia/:alunoId → resumo de frequência
 */

const Aluno = require('../models/Aluno');
const Nota  = require('../models/Nota');
const Falta = require('../models/Falta');
const FrequenciaProfessor = require('../models/FrequenciaProfessor');

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Encontra o aluno vinculado ao e-mail do responsável.
 * O campo `responsavel` no modelo Aluno armazena o nome ou e-mail do responsável.
 * Também aceita busca por matrícula passada como query param.
 */
async function findAlunoByResponsavel(email, matricula) {
    const query = matricula
        ? { matricula }
        : { $or: [{ responsavel: email }, { responsavel: new RegExp(email, 'i') }] };

    return Aluno.findOne(query).lean();
}

/**
 * Middleware de segurança (IDOR protection):
 * Verifica se o aluno solicitado realmente pertence ao responsável logado.
 */
async function verifyOwnership(alunoId, email) {
    if (!email) return false;
    const aluno = await Aluno.findOne({
        $and: [
            { $or: [{ _id: alunoId }, { id: alunoId }] },
            { $or: [{ responsavel: email }, { responsavel: new RegExp(`^${email}$`, 'i') }] }
        ]
    }).lean();
    return !!aluno;
}

// ─── GET /api/responsavel/alunos ──────────────────────────────────────────────
exports.getAlunos = async (req, res) => {
    try {
        const email = req.user?.email || req.query.email;

        if (!email) {
            return res.status(400).json({ success: false, error: 'E-mail obrigatório.' });
        }

        const query = { $or: [{ responsavel: email }, { responsavel: new RegExp(`^${email}$`, 'i') }] };
        const alunos = await Aluno.find(query).lean();

        // Retorna todos os dados para o frontend usar (dados pessoais, médicos, etc)
        const safeAlunos = alunos.map(aluno => {
            const safe = {
                ...aluno,
                id:             aluno._id,
                nome:           aluno.nome,
                sobrenome:      aluno.sobrenome || '',
                matricula:      aluno.matricula,
                turma:          aluno.turma || aluno.turmaId,
                dataNascimento: aluno.nascimento,
                ativo:          aluno.ativo,
                foto:           aluno.foto || null,
                cpfAluno:       aluno.cpfAluno || '',
                telefone:       aluno.telefone || '',
                endereco:       aluno.endereco || null,
                nacionalidade:  aluno.nacionalidade || '',
                etnia:          aluno.etnia || '',
                religiao:       aluno.religiao || '',
                responsavelDados: aluno.responsavelDados || null,
                alergiasAlimentos: aluno.alergiasAlimentos || '',
                alergiasRemedio: aluno.alergiasRemedio || '',
                planoSaude:     aluno.planoSaude || '',
                deficiencia:    aluno.deficiencia || '',
                pcd:            aluno.pcd || false,
                nivel:          aluno.nivel || '',
                condicao:       aluno.condicao || '',
                observacoes:    aluno.observacoes || '',
                documentos:     aluno.documentos || [],
                lgpdConsentimento: aluno.lgpdConsentimento || null
            };
            if (safe.foto && safe.foto.length > 20 && !safe.foto.startsWith('data:') && !safe.foto.startsWith('/api')) {
                safe.foto = `/api/upload/photo/${safe.foto}`;
            }
            return safe;
        });

        res.json({ success: true, data: safeAlunos });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
};

// ─── GET /api/responsavel/buscar-aluno ────────────────────────────────────────
exports.buscarAluno = async (req, res) => {
    try {
        const { q } = req.query;
        if (!q || q.length < 3) {
            return res.status(400).json({ success: false, error: 'Digite pelo menos 3 caracteres para buscar.' });
        }

        // Buscar por nome ou matrícula, ignorando case
        const regex = new RegExp(q, 'i');
        const query = {
            $or: [{ nome: regex }, { sobrenome: regex }, { matricula: regex }],
            ativo: true
        };

        const alunos = await Aluno.find(query).limit(10).lean();

        // Mapear alunos: se já tiver responsável, a gente oculta a info sensível ou apenas avisa que está vinculado
        const resultados = alunos.map(a => ({
            id: a._id,
            nome: `${a.nome} ${a.sobrenome || ''}`.trim(),
            matricula: a.matricula,
            turma: a.turma || a.turmaId,
            vinculado: !!a.responsavel // true se já tiver responsável
        }));

        res.json({ success: true, data: resultados });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
};

// ─── POST /api/responsavel/vincular ──────────────────────────────────────────
exports.vincularAluno = async (req, res) => {
    try {
        const email = req.user?.email;
        const { alunoId } = req.body;

        if (!email) return res.status(401).json({ success: false, error: 'Não autenticado' });
        if (!alunoId) return res.status(400).json({ success: false, error: 'ID do aluno obrigatório.' });

        const aluno = await Aluno.findById(alunoId);
        if (!aluno) {
            return res.status(404).json({ success: false, error: 'Aluno não encontrado.' });
        }

        if (aluno.responsavel) {
            return res.status(400).json({ success: false, error: 'Este aluno já possui um responsável vinculado.' });
        }

        // Vincular
        aluno.responsavel = email;
        await aluno.save();

        res.json({ success: true, message: 'Aluno vinculado com sucesso!' });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
};

// ─── GET /api/responsavel/notas/:alunoId ─────────────────────────────────────
exports.getNotas = async (req, res) => {
    try {
        const { alunoId } = req.params;
        const email = req.user?.email;

        const isOwner = await verifyOwnership(alunoId, email);
        if (!isOwner) {
            return res.status(403).json({ success: false, error: 'Acesso negado. Aluno não vinculado à sua conta.' });
        }

        const aluno = await Aluno.findOne({ $or: [{ _id: alunoId }, { id: alunoId }] }).lean();
        if (!aluno) {
            return res.status(404).json({ success: false, error: 'Aluno não encontrado.' });
        }

        const notas = await Nota.find({
            $or: [
                { alunoId: String(aluno._id) },
                { alunoId: aluno._id },
                { alunoId: aluno.id },
                { matriculaId: aluno.matricula }
            ]
        })
            .sort({ materiaId: 1, bimestre: 1 })
            .lean();

        if (!notas.length) {
            return res.json({ success: true, data: [] });
        }

        // Estrutura: agrupa por matéria → array de média por bimestre
        const porMateria = {};

        notas.forEach((n) => {
            const materia  = n.materiaId || n.descricao || 'Geral';
            const bimestre = n.bimestre  || 0;

            if (!porMateria[materia]) {
                porMateria[materia] = {
                    disciplina: materia,
                    professor:  n.professor || null,
                    porBimestre: {},
                };
            }

            const bKey = String(bimestre);
            if (!porMateria[materia].porBimestre[bKey]) {
                porMateria[materia].porBimestre[bKey] = { soma: 0, count: 0 };
            }

            if (n.nota !== undefined && n.nota !== null) {
                porMateria[materia].porBimestre[bKey].soma  += parseFloat(n.nota);
                porMateria[materia].porBimestre[bKey].count += 1;
            }
        });

        // Converte para o formato esperado pelo frontend:
        // { disciplina, professor, bimestres: [b1, b2, b3, b4] }
        const resultado = Object.values(porMateria).map((m, idx) => {
            const bimestres = [1, 2, 3, 4].map((b) => {
                const entry = m.porBimestre[String(b)];
                if (!entry || entry.count === 0) return 0;
                return Math.round((entry.soma / entry.count) * 10) / 10;
            });

            return {
                id:         `grade-${idx}`,
                disciplina: m.disciplina,
                professor:  m.professor,
                bimestres,
            };
        });

        res.json({ success: true, data: resultado });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
};

// ─── GET /api/responsavel/frequencia/:alunoId ────────────────────────────────
exports.getFrequencia = async (req, res) => {
    try {
        const { alunoId } = req.params;
        const email = req.user?.email;

        const isOwner = await verifyOwnership(alunoId, email);
        if (!isOwner) {
            return res.status(403).json({ success: false, error: 'Acesso negado. Aluno não vinculado à sua conta.' });
        }

        const aluno = await Aluno.findOne({ $or: [{ _id: alunoId }, { id: alunoId }] }).lean();
        if (!aluno) {
            return res.status(404).json({ success: false, error: 'Aluno não encontrado.' });
        }

        // Buscar registros na coleção de faltas
        const queryFaltas = {
            $or: [
                { aluno: String(aluno._id) },
                { aluno: aluno._id },
                { aluno: aluno.id },
                { alunoId: String(aluno._id) },
                { alunoId: aluno._id },
                { alunoId: aluno.id },
                { matriculaId: aluno.matricula }
            ]
        };
        const faltas = await Falta.find(queryFaltas).lean();

        // 1. Filtrar ausências efetivas (presente === false ou ausente no sistema legacy sem o campo 'presente')
        const faltasEfetivas = faltas.filter((f) => f.presente === false || f.presente === undefined);
        const ausencia = faltasEfetivas.filter((f) => !f.justificada).length;
        const atraso   = faltasEfetivas.filter((f) => f.justificada).length;

        // 2. Determinar a quantidade total de aulas ministradas para a turma deste aluno
        const turmasBusca = [aluno.turma, aluno.turmaId].filter(Boolean);
        const aulasProfessor = await FrequenciaProfessor.find({
            classe: { $in: turmasBusca }
        }).lean();

        let totalAulas = 0;
        if (aulasProfessor.length > 0) {
            totalAulas = aulasProfessor.reduce((sum, aula) => sum + (aula.quantidadeAulas || 1), 0);
        } else {
            // Caso não tenha registros em FrequenciaProfessor, tenta pegar dias distintos de chamadas da turma
            const totalDiasDistintos = await Falta.distinct('data', {
                turma: { $in: turmasBusca }
            });
            totalAulas = totalDiasDistintos.length;
        }

        // Garante que o total de aulas é pelo menos o total de registros do próprio aluno
        const totalRegistrosDoAluno = faltas.length;
        if (totalAulas < totalRegistrosDoAluno) {
            totalAulas = totalRegistrosDoAluno;
        }

        // Se total de aulas ainda for zero, usa um padrão seguro
        if (totalAulas === 0) {
            totalAulas = 50; 
        }

        // A presença do aluno é o total de aulas ministradas menos suas ausências e atrasos
        let presenca = totalAulas - ausencia - atraso;
        if (presenca < 0) presenca = 0;

        const percentual = totalAulas > 0
            ? Math.round((presenca / totalAulas) * 100)
            : 100;

        res.json({
            success: true,
            data: { presenca, ausencia, atraso, percentual },
        });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
};

// ─── GET /api/responsavel/notificacoes/:alunoId ─────────────────────────────
exports.getNotificacoes = async (req, res) => {
    try {
        const { alunoId } = req.params;
        const email = req.user?.email;

        // Proteção IDOR: Garante que o responsável logado seja dono deste aluno
        const isOwner = await verifyOwnership(alunoId, email);
        if (!isOwner) {
            return res.status(403).json({ success: false, error: 'Acesso negado. Aluno não vinculado à sua conta.' });
        }

        const Notificacao = require('../models/Notificacao');
        const aluno = await Aluno.findOne({
            $or: [{ _id: alunoId }, { id: alunoId }]
        }).lean();

        if (!aluno) {
            return res.status(404).json({ success: false, error: 'Aluno não encontrado' });
        }

        const turmaId = aluno.turma || aluno.turmaId;

        // Monta lista de destinatários possíveis para evitar type-mismatches do MongoDB (String vs Number)
        const destinatariosList = ['todos', turmaId];
        if (alunoId) {
            destinatariosList.push(String(alunoId));
            if (!isNaN(Number(alunoId))) {
                destinatariosList.push(Number(alunoId));
            }
        }
        if (aluno._id) {
            destinatariosList.push(String(aluno._id));
        }
        if (aluno.id) {
            destinatariosList.push(String(aluno.id));
            if (!isNaN(Number(aluno.id))) {
                destinatariosList.push(Number(aluno.id));
            }
        }

        const ocultadosList = [String(alunoId)];
        if (aluno._id) ocultadosList.push(String(aluno._id));
        if (aluno.id) ocultadosList.push(String(aluno.id));

        // Buscando notificações onde destinatarios é 'todos', ou turmaId, ou alunoId
        const notificacoes = await Notificacao.find({
            destinatarios: { $in: destinatariosList },
            ocultadoPor: { $nin: ocultadosList }
        }).sort({ dataCriacao: -1 }).lean();

        const iconMap = {
            'info': '📢',
            'aviso': '⚠️',
            'evento': '🎉',
            'financeiro': '💰',
            'academico': '📚',
            'saude': '🏥',
            'falta': '📋'
        };

        const formatted = notificacoes.map(n => ({
            id: n.id || String(n._id),
            tipo: n.tipo,
            titulo: n.titulo,
            mensagem: n.mensagem,
            dataCriacao: n.dataCriacao,
            lido: n.lido ? n.lido.includes(alunoId) : false,
            destinatarios: n.destinatarios,
            icon: iconMap[n.tipo] || '🔔'
        }));

        res.json({ success: true, data: formatted });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
};

// ─── PUT /api/responsavel/notificacoes/:id/ler ──────────────────────────────
exports.marcarComoLida = async (req, res) => {
    try {
        const { id } = req.params;
        const { alunoId } = req.body;
        const email = req.user?.email;

        if (!alunoId) {
            return res.status(400).json({ success: false, error: 'ID do aluno obrigatório.' });
        }

        const isOwner = await verifyOwnership(alunoId, email);
        if (!isOwner) {
            return res.status(403).json({ success: false, error: 'Acesso negado. Aluno não vinculado à sua conta.' });
        }

        const Notificacao = require('../models/Notificacao');
        const notificacao = await Notificacao.findOne({ $or: [{ _id: id }, { id: id }] });
        if (!notificacao) {
            return res.status(404).json({ success: false, error: 'Notificação não encontrada.' });
        }

        // Adiciona o alunoId ao array lido se não estiver lá
        if (!notificacao.lido.includes(alunoId)) {
            notificacao.lido.push(alunoId);
            await notificacao.save();
        }

        res.json({ success: true, message: 'Notificação marcada como lida.' });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
};

// ─── PUT /api/responsavel/notificacoes/:id/ocultar ──────────────────────────
exports.ocultarNotificacao = async (req, res) => {
    try {
        const { id } = req.params;
        const { alunoId } = req.body;
        const email = req.user?.email;

        if (!alunoId) {
            return res.status(400).json({ success: false, error: 'ID do aluno obrigatório.' });
        }

        const isOwner = await verifyOwnership(alunoId, email);
        if (!isOwner) {
            return res.status(403).json({ success: false, error: 'Acesso negado. Aluno não vinculado à sua conta.' });
        }

        const Notificacao = require('../models/Notificacao');
        const notificacao = await Notificacao.findOne({ $or: [{ _id: id }, { id: id }] });
        if (!notificacao) {
            return res.status(404).json({ success: false, error: 'Notificação não encontrada.' });
        }

        // Adiciona o alunoId ao array ocultadoPor se não estiver lá
        if (!notificacao.ocultadoPor) {
            notificacao.ocultadoPor = [];
        }
        if (!notificacao.ocultadoPor.includes(alunoId)) {
            notificacao.ocultadoPor.push(alunoId);
            await notificacao.save();
        }

        res.json({ success: true, message: 'Notificação ocultada para o usuário.' });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
};
