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
const Nota = require('../models/Nota');
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
    const emailRegex = new RegExp(`^${email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
    const aluno = await Aluno.findOne({
        $and: [
            { $or: [{ _id: alunoId }, { id: alunoId }] },
            {
                $or: [
                    { responsavel: emailRegex },
                    { 'responsavelDados.email': emailRegex },
                    { 'responsaveis.email': emailRegex }
                ]
            }
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

        const emailRegex = new RegExp(`^${email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
        const query = {
            $or: [
                { responsavel: emailRegex },
                { responsavel: new RegExp(`^${email}$`, 'i') },
                { 'responsavelDados.email': emailRegex },
                { 'responsaveis.email': emailRegex }
            ]
        };
        const alunos = await Aluno.find(query).lean();

        // Retorna todos os dados para o frontend usar (dados pessoais, médicos, etc)
        const safeAlunos = alunos.map(aluno => {
            const safe = {
                ...aluno,
                id: aluno._id,
                nome: aluno.nome,
                sobrenome: aluno.sobrenome || '',
                matricula: aluno.matricula,
                turma: aluno.turma || aluno.turmaId,
                dataNascimento: aluno.nascimento,
                ativo: aluno.ativo,
                foto: aluno.foto || null,
                cpfAluno: aluno.cpfAluno || '',
                telefone: aluno.telefone || '',
                endereco: aluno.endereco || null,
                nacionalidade: aluno.nacionalidade || '',
                etnia: aluno.etnia || '',
                religiao: aluno.religiao || '',
                responsavelDados: aluno.responsavelDados || null,
                responsaveis: aluno.responsaveis || [],
                guardaLegal: aluno.guardaLegal || '',
                pessoasAutorizadasRetirada: aluno.pessoasAutorizadasRetirada || [],
                autorizacoesEscolares: aluno.autorizacoesEscolares || null,
                fichaDocumentoStatus: aluno.fichaDocumentoStatus || 'pendente',
                alergiasAlimentos: aluno.alergiasAlimentos || '',
                alergiasRemedio: aluno.alergiasRemedio || '',
                planoSaude: aluno.planoSaude || '',
                deficiencia: aluno.deficiencia || '',
                pcd: aluno.pcd || false,
                nivel: aluno.nivel || '',
                condicao: aluno.condicao || '',
                observacoes: aluno.observacoes || '',
                documentos: aluno.documentos || [],
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

// ─── GET /api/responsavel/buscar-aluno/:codigo ───────────────────────────────
// Permite ao responsável conferir os dados básicos do aluno antes de vincular.
exports.buscarAluno = async (req, res) => {
    try {
        const { codigo } = req.params;
        if (!codigo) {
            return res.status(400).json({ success: false, error: 'Código secreto não fornecido.' });
        }

        const sanitizedCode = codigo.trim().toUpperCase();
        console.log(`🔍 [LINK-STUDENT] Buscando aluno pelo código: ${sanitizedCode}`);

        // Busca aluno pelo código secreto (deve ser único conforme o model)
        const aluno = await Aluno.findOne({ 
            codigoSecreto: sanitizedCode,
            ativo: { $ne: false } 
        }).select('nome sobrenome turma turmaId matricula responsavel').lean();

        if (!aluno) {
            console.warn(`❌ [LINK-STUDENT] Código inválido ou aluno inativo: ${sanitizedCode}`);
            return res.status(404).json({
                success: false,
                error: 'Estudante não encontrado com este código secreto. Verifique se o código está correto ou se o aluno está ativo.'
            });
        }

        // Se já tem um responsável vinculado, avisa (mas permite se o usuário quiser sobrescrever ou se for o mesmo)
        const vinculado = !!aluno.responsavel;

        res.json({
            success: true,
            data: {
                id: aluno._id,
                nome: `${aluno.nome}${aluno.sobrenome ? ' ' + aluno.sobrenome : ''}`,
                turma: aluno.turma || aluno.turmaId || 'N/D',
                matricula: aluno.matricula || 'N/D',
                jaVinculado: vinculado
            }
        });
    } catch (err) {
        console.error(`❌ [LINK-STUDENT] Erro na busca por código:`, err.message);
        res.status(500).json({ success: false, error: 'Erro interno ao buscar aluno.' });
    }
};

// ─── POST /api/responsavel/vincular ──────────────────────────────────────────
// Permite vincular um aluno à conta logada do responsável usando o código secreto de forma segura.
exports.vincularAluno = async (req, res) => {
    try {
        const { codigoSecreto } = req.body;
        const email = req.user?.email || req.user?._id;

        if (!email) {
            return res.status(401).json({ success: false, error: 'Usuário não autenticado.' });
        }

        if (!codigoSecreto) {
            return res.status(400).json({ success: false, error: 'O código secreto é obrigatório.' });
        }

        const sanitizedCode = codigoSecreto.trim().toUpperCase();

        // Buscar aluno pelo código secreto
        const aluno = await Aluno.findOne({
            codigoSecreto: sanitizedCode,
            ativo: { $ne: false }
        });

        if (!aluno) {
            console.warn(`❌ [LINK-LINK] Falha ao vincular: código ${sanitizedCode} não encontrado ou inativo.`);
            return res.status(404).json({
                success: false,
                error: 'Código secreto inválido ou aluno inativo. Por favor, confirme o código com a secretaria.'
            });
        }

        // Se já está vinculado a outro e-mail, registramos isso no log
        if (aluno.responsavel && aluno.responsavel !== email.toLowerCase()) {
            console.warn(`⚠️ [LINK-STUDENT] Sobrescrevendo responsável do aluno ${aluno.nome}: de ${aluno.responsavel} para ${email}`);
        }

        // Vincula o aluno definindo o e-mail do responsável
        const targetEmail = email.toLowerCase();
        aluno.responsavel = targetEmail;
        
        // Atualiza responsavelDados se necessário
        if (!aluno.responsavelDados) {
            aluno.responsavelDados = {};
        }
        aluno.responsavelDados.email = targetEmail;
        
        await Aluno.updateOne(
            { _id: aluno._id },
            { 
                $set: { 
                    responsavel: targetEmail,
                    responsavelDados: aluno.responsavelDados
                } 
            }
        );

        const { logAction } = require('../utils/auditHelper');
        await logAction(req, 'LINK_STUDENT_VIA_CODE', 'Alunos', {
            recursoId: aluno._id,
            valorNovo: { email: targetEmail },
            descricao: `Vínculo realizado: Responsável ${targetEmail} vinculou o aluno ${aluno.nome} via código secreto ${sanitizedCode}.`
        });

        console.log(`✅ [LINK-STUDENT] Sucesso: Aluno ${aluno.nome} vinculado a ${targetEmail}`);

        res.json({
            success: true,
            message: 'Aluno vinculado com sucesso!',
            data: {
                id: aluno._id,
                nome: aluno.nome,
                matricula: aluno.matricula,
                turma: aluno.turma || aluno.turmaId
            }
        });
    } catch (e) {
        console.error(`❌ [LINK-STUDENT] Erro no vínculo:`, e.message);
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
            const materia = n.materiaId || n.descricao || 'Geral';
            const bimestre = n.bimestre || 0;

            if (!porMateria[materia]) {
                porMateria[materia] = {
                    disciplina: materia,
                    professor: n.professor || null,
                    porBimestre: {},
                };
            }

            const bKey = String(bimestre);
            if (!porMateria[materia].porBimestre[bKey]) {
                porMateria[materia].porBimestre[bKey] = { soma: 0, count: 0 };
            }

            if (n.nota !== undefined && n.nota !== null) {
                porMateria[materia].porBimestre[bKey].soma += parseFloat(n.nota);
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
                id: `grade-${idx}`,
                disciplina: m.disciplina,
                professor: m.professor,
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
        // Permite passar dataAtual via query param para testes determinísticos
        const dataReferencia = req.query.dataAtual ? new Date(req.query.dataAtual) : new Date();

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
        let ausencia = faltasEfetivas.filter((f) => !f.justificada).length;
        const atraso = faltasEfetivas.filter((f) => f.justificada).length;

        // Se o professor lançou faltas manualmente no boletim/cadastro do aluno (faltasBimestre),
        // isso deve ser considerado (geralmente como o total de ausências do aluno).
        if (aluno.faltasBimestre) {
            const values = aluno.faltasBimestre instanceof Map
                ? Array.from(aluno.faltasBimestre.values())
                : Object.values(aluno.faltasBimestre || {});

            const manualAbsences = values.reduce((sum, val) => sum + (Number(val) || 0), 0);
            if (manualAbsences > ausencia) {
                ausencia = manualAbsences;
            }
        }

        // 2. Calcular dias letivos decorridos em 2026 até a data de referência
        const getElapsedSchoolDays = (dateObj) => {
            // Normaliza tudo em UTC para evitar distorções de fuso horário local
            const todayUTC = Date.UTC(dateObj.getUTCFullYear(), dateObj.getUTCMonth(), dateObj.getUTCDate());
            const startUTC = Date.UTC(2026, 1, 9); // 09/02/2026 (fevereiro é 1)

            if (todayUTC < startUTC) return 0;

            let count = 0;
            let temp = new Date(startUTC);
            while (temp.getTime() <= todayUTC) {
                const day = temp.getUTCDay();
                if (day !== 0 && day !== 6) { // Ignora Sábado e Domingo
                    count++;
                }
                temp.setUTCDate(temp.getUTCDate() + 1);
            }

            // Feriados e recessos nacionais em dias de semana ocorridos em 2026 (em UTC)
            const holidays = [
                Date.UTC(2026, 1, 16), // Carnaval Segunda-feira
                Date.UTC(2026, 1, 17), // Carnaval Terça-feira
                Date.UTC(2026, 3, 3),  // Sexta-feira Santa
                Date.UTC(2026, 3, 21), // Tiradentes
                Date.UTC(2026, 4, 1)   // Dia do Trabalho
            ];

            holidays.forEach(hTime => {
                if (hTime >= startUTC && hTime <= todayUTC) {
                    const hDate = new Date(hTime);
                    const day = hDate.getUTCDay();
                    if (day !== 0 && day !== 6) {
                        count--;
                    }
                }
            });

            return Math.min(count, 200);
        };

        const elapsedDays = getElapsedSchoolDays(dataReferencia);

        // 3. Determinar a quantidade total de aulas/dias letivos a serem considerados
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

        // Conta as presenças reais/efetivas no sistema (chamadas diárias onde presente === true)
        const presencasEfetivas = faltas.filter((f) => f.presente === true).length;

        // Garante que o total de aulas é pelo menos o maior valor entre:
        // - Dias letivos decorridos até hoje no calendário de 2026
        // - Aulas registradas em banco pelos professores
        // - Soma das ausências (manuais ou calculadas), atrasos e presenças reais.
        const totalRegistrosDoAluno = faltas.length;
        const minAulas = ausencia + atraso + presencasEfetivas;

        if (totalAulas < elapsedDays) {
            totalAulas = elapsedDays;
        }
        if (totalAulas < totalRegistrosDoAluno) {
            totalAulas = totalRegistrosDoAluno;
        }
        if (totalAulas < minAulas) {
            totalAulas = minAulas;
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
        const destinatariosList = ['todos', 'responsaveis', turmaId, `turma:${turmaId}`].filter(Boolean);
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
        // Adicionado paraResponsavel: true para isolar completamente e impedir que avisos de staff apareçam para pais
        const notificacoes = await Notificacao.find({
            paraResponsavel: true,
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

        const formatted = notificacoes.map(n => {
            const nId = n.id || String(n._id);
            const isRead = n.lido ? (n.lido.includes(String(alunoId)) || (aluno.id && n.lido.includes(String(aluno.id))) || (aluno._id && n.lido.includes(String(aluno._id)))) : false;
            
            return {
                id: nId,
                tipo: n.tipo,
                titulo: n.titulo,
                mensagem: n.mensagem,
                corpoHtml: n.corpoHtml,
                comunicadoId: n.comunicadoId ? String(n.comunicadoId) : undefined,
                dataCriacao: n.dataCriacao,
                lido: isRead,
                destinatarios: n.destinatarios,
                criadoPor: n.criadoPor || 'Direção',
                icon: iconMap[n.tipo] || '🔔'
            };
        });

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
        const currentAluId = String(alunoId);
        if (!notificacao.lido.includes(currentAluId)) {
            notificacao.lido.push(currentAluId);
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

// ─── PUT /api/responsavel/aluno/:alunoId/dados ───────────────────────────────
exports.updateAlunoDados = async (req, res) => {
    try {
        const { alunoId } = req.params;
        const email = req.user?.email;
        if (!email) return res.status(401).json({ success: false, error: 'Não autenticado.' });

        const isOwner = await verifyOwnership(alunoId, email);
        if (!isOwner) return res.status(403).json({ success: false, error: 'Acesso negado.' });

        const allowed = ['responsaveis', 'guardaLegal', 'pessoasAutorizadasRetirada', 'autorizacoesEscolares', 'responsavelDados'];
        const update = {};
        allowed.forEach(k => { if (req.body[k] !== undefined) update[k] = req.body[k]; });

        if (update.responsaveis && update.responsaveis.length > 2) {
            return res.status(400).json({ success: false, error: 'Máximo de 2 responsáveis por aluno.' });
        }

        const aluno = await Aluno.findOneAndUpdate(
            { $or: [{ _id: alunoId }, { id: alunoId }] },
            { $set: update },
            { new: true }
        ).lean();

        if (!aluno) return res.status(404).json({ success: false, error: 'Aluno não encontrado.' });
        res.json({ success: true, data: aluno });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
};

// ─── POST /api/responsavel/aluno/:alunoId/documentos ─────────────────────────
exports.uploadDocumentos = async (req, res) => {
    try {
        const { alunoId } = req.params;
        const email = req.user?.email;
        if (!email) return res.status(401).json({ success: false, error: 'Não autenticado.' });

        const isOwner = await verifyOwnership(alunoId, email);
        if (!isOwner) return res.status(403).json({ success: false, error: 'Acesso negado.' });

        const { arquivos } = req.body;
        if (!arquivos || !Array.isArray(arquivos) || arquivos.length === 0) {
            return res.status(400).json({ success: false, error: 'Nenhum arquivo informado.' });
        }

        const novosArquivos = arquivos.map(a => ({
            id: a.id || require('crypto').randomBytes(8).toString('hex'),
            nome: a.nome,
            tipo: a.tipo,
            gridfsId: a.gridfsId,
            enviadoEm: new Date()
        }));

        const aluno = await Aluno.findOne({ $or: [{ _id: alunoId }, { id: alunoId }] });
        if (!aluno) return res.status(404).json({ success: false, error: 'Aluno não encontrado.' });

        const docsAtuais = aluno.documentos?.arquivos || (Array.isArray(aluno.documentos) ? aluno.documentos : []);
        const todosArquivos = [...docsAtuais, ...novosArquivos];

        aluno.documentos = {
            arquivos: todosArquivos,
            ultimoEnvio: new Date()
        };
        aluno.fichaDocumentoStatus = 'enviado';
        await aluno.save();

        res.json({ success: true, data: { documentos: aluno.documentos, fichaDocumentoStatus: aluno.fichaDocumentoStatus } });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
};

// ─── PUT /api/responsavel/aluno/:alunoId/documento-status (admin/secretaria) ─
exports.updateDocumentoStatus = async (req, res) => {
    try {
        const perfil = req.user?.perfil;
        if (!['admin', 'diretor'].includes(perfil)) {
            return res.status(403).json({ success: false, error: 'Apenas secretaria/admin pode conferir documentos.' });
        }

        const { alunoId } = req.params;
        const { status } = req.body;
        if (!['pendente', 'enviado', 'conferido'].includes(status)) {
            return res.status(400).json({ success: false, error: 'Status inválido.' });
        }

        const update = { fichaDocumentoStatus: status };
        if (status === 'conferido') {
            update['documentos.conferidoEm'] = new Date();
            update['documentos.conferidoPor'] = req.user.email;
        }

        const aluno = await Aluno.findOneAndUpdate(
            { $or: [{ _id: alunoId }, { id: alunoId }] },
            { $set: update },
            { new: true }
        ).lean();

        if (!aluno) return res.status(404).json({ success: false, error: 'Aluno não encontrado.' });
        res.json({ success: true, data: aluno });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
};
