/**
 * AvaliacaoController.js
 * ============================================================================
 * Gestão completa de Avaliações Escolares e Lançamento de Notas com:
 *  - Validação de intervalo de nota 0–10
 *  - Controle de Acesso Baseado em Papel (RBAC) e Isolamento Horizontal
 *  - Auto-cálculo de médias, maior/menor nota e taxa de aprovação
 *  - Histórico e trilha de auditoria para alterações de notas
 *  - Multi-escola (tenant isolation)
 * ============================================================================
 */

const Avaliacao = require('../models/Avaliacao');
const Nota = require('../models/Nota');
const Aluno = require('../models/Aluno');
const AvaliacaoHistorico = require('../models/AvaliacaoHistorico');
const AuditoriaService = require('../services/AuditoriaService');

const TIPOS_VALIDOS = [
    'Prova',
    'Trabalho',
    'Seminário',
    'Redação',
    'Simulado',
    'Atividade',
    'Outro',
];

// Validador de nota 0 a 10
function validarNota(valor) {
    if (valor === null || valor === undefined || valor === '') {
        return { valido: true, valor: null };
    }
    const n = parseFloat(valor);
    if (Number.isNaN(n) || n < 0 || n > 10) {
        return { valido: false, msg: 'A nota deve ser um número entre 0 e 10.' };
    }
    return { valido: true, valor: Math.round(n * 10) / 10 };
}

// Determina status pedagógico
function calcularStatus(nota, presente) {
    if (presente === false) return 'Reprovado';
    if (nota === null || nota === undefined) return 'Pendente';
    if (nota >= 6.0) return 'Aprovado';
    if (nota >= 4.0) return 'Recuperação';
    return 'Reprovado';
}

// ----------------------------------------------------------------------------
// GET /api/avaliacoes-escolares
// ----------------------------------------------------------------------------
exports.list = async (req, res) => {
    try {
        const filters = {};
        if (req.escolaId) filters.escolaId = req.escolaId;
        if (req.query.turmaId) filters.turmaId = req.query.turmaId;
        if (req.query.materiaId) filters.materiaId = req.query.materiaId;
        if (req.query.bimestre) filters.bimestre = Number(req.query.bimestre);

        // Isolamento horizontal para professor
        if (req.user && req.user.perfil === 'professor') {
            const allowed = req.allowedTurmas || [];
            if (req.query.turmaId && !allowed.includes(req.query.turmaId)) {
                return res
                    .status(403)
                    .json({ success: false, error: 'Acesso negado para esta turma.' });
            }
            if (!req.query.turmaId) {
                filters.turmaId = { $in: allowed };
            }
        }

        const avaliacoes = await Avaliacao.find(filters).sort({ data: -1, createdAt: -1 }).lean();

        // Enriquecer com contagem de notas lançadas e média prévia
        const avaliacaoIds = avaliacoes.map((a) => a._id || a.id);
        const notasAgg = await Nota.aggregate([
            { $match: { avaliacaoId: { $in: avaliacaoIds } } },
            {
                $group: {
                    _id: '$avaliacaoId',
                    totalNotas: { $sum: 1 },
                    somaNotas: { $sum: '$nota' },
                    media: { $avg: '$nota' },
                },
            },
        ]);

        const notasMap = {};
        notasAgg.forEach((agg) => {
            notasMap[agg._id] = {
                totalNotas: agg.totalNotas,
                media: agg.media ? Math.round(agg.media * 10) / 10 : 0,
            };
        });

        const data = avaliacoes.map((a) => {
            const key = String(a._id || a.id);
            return {
                ...a,
                id: a._id || a.id,
                totalNotas: notasMap[key]?.totalNotas || 0,
                mediaTurma: notasMap[key]?.media || null,
            };
        });

        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};

// ----------------------------------------------------------------------------
// GET /api/avaliacoes-escolares/:id
// ----------------------------------------------------------------------------
exports.get = async (req, res) => {
    try {
        const id = req.params.id;
        const avaliacao = await Avaliacao.findOne({
            $or: [{ _id: id }, { id: id }],
            ...(req.escolaId ? { escolaId: req.escolaId } : {}),
        }).lean();

        if (!avaliacao) {
            return res.status(404).json({ success: false, error: 'Avaliação não encontrada.' });
        }

        // Validação horizontal para professor
        if (req.user && req.user.perfil === 'professor') {
            const allowed = req.allowedTurmas || [];
            if (!allowed.includes(avaliacao.turmaId)) {
                return res
                    .status(403)
                    .json({ success: false, error: 'Acesso negado para esta turma.' });
            }
        }

        // Buscar alunos da turma
        const alunos = await Aluno.find({
            $or: [{ turma: avaliacao.turmaId }, { turmaId: avaliacao.turmaId }],
            ...(req.escolaId ? { escolaId: req.escolaId } : {}),
            ativo: { $ne: false },
        })
            .sort({ nome: 1 })
            .select('id _id nome matricula turma foto')
            .lean();

        // Buscar notas já lançadas para esta avaliação
        const notas = await Nota.find({
            avaliacaoId: String(avaliacao._id || avaliacao.id),
            ...(req.escolaId ? { escolaId: req.escolaId } : {}),
        }).lean();

        const notasMap = {};
        notas.forEach((n) => {
            notasMap[String(n.alunoId)] = n;
        });

        // Combinar aluno com sua nota
        let somaNotas = 0;
        let contComNota = 0;
        let contAvaliados = 0;
        let contAprovados = 0;
        let contRecuperacao = 0;
        let contReprovados = 0;
        let maiorNota = null;
        let menorNota = null;

        const alunosComNotas = alunos.map((aluno) => {
            const aId = String(aluno.id || aluno._id);
            const notaDoc = notasMap[aId];

            let notaValor = null;
            let presente = true;
            let observacoes = '';
            let status = 'Pendente';
            let notaId = null;

            if (notaDoc) {
                notaId = notaDoc._id || notaDoc.id;
                notaValor =
                    notaDoc.nota !== undefined && notaDoc.nota !== null ? notaDoc.nota : null;
                presente = notaDoc.presente !== false;
                observacoes = notaDoc.observacoes || notaDoc.descricao || '';
                status = notaDoc.status || calcularStatus(notaValor, presente);

                if (presente && notaValor !== null) {
                    somaNotas += notaValor;
                    contComNota++;
                    contAvaliados++;
                    if (maiorNota === null || notaValor > maiorNota) maiorNota = notaValor;
                    if (menorNota === null || notaValor < menorNota) menorNota = notaValor;

                    if (notaValor >= 6.0) contAprovados++;
                    else if (notaValor >= 4.0) contRecuperacao++;
                    else contReprovados++;
                } else if (!presente) {
                    contAvaliados++;
                    contReprovados++;
                }
            }

            return {
                alunoId: aId,
                alunoNome: aluno.nome,
                alunoMatricula: aluno.matricula || '',
                alunoFoto: aluno.foto || null,
                notaId,
                nota: notaValor,
                presente,
                observacoes,
                status,
            };
        });

        const mediaTurma = contComNota > 0 ? Math.round((somaNotas / contComNota) * 10) / 10 : 0;
        const taxaAprovacao =
            contAvaliados > 0 ? Math.round((contAprovados / contAvaliados) * 100) : 0;

        res.json({
            success: true,
            data: {
                ...avaliacao,
                id: avaliacao._id || avaliacao.id,
                alunos: alunosComNotas,
                metricas: {
                    totalAlunos: alunos.length,
                    avaliados: contAvaliados,
                    aprovados: contAprovados,
                    recuperacao: contRecuperacao,
                    reprovados: contReprovados,
                    mediaTurma,
                    maiorNota: maiorNota !== null ? maiorNota : 0,
                    menorNota: menorNota !== null ? menorNota : 0,
                    taxaAprovacao,
                },
            },
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};

// ----------------------------------------------------------------------------
// POST /api/avaliacoes-escolares
// ----------------------------------------------------------------------------
exports.create = async (req, res) => {
    try {
        const { titulo, descricao, turmaId, materiaId, bimestre, tipo, peso, data } = req.body;

        if (!titulo || !turmaId || !materiaId || !bimestre) {
            return res.status(400).json({
                success: false,
                error: 'Título, Turma, Disciplina e Bimestre são obrigatórios.',
            });
        }

        // Validação de permissão do professor
        if (req.user && req.user.perfil === 'professor') {
            const allowed = req.allowedTurmas || [];
            if (!allowed.includes(turmaId)) {
                return res.status(403).json({
                    success: false,
                    error: `Acesso negado. Você não leciona para a turma ${turmaId}.`,
                });
            }
        }

        const novaAvaliacao = {
            titulo: String(titulo).trim(),
            descricao: descricao ? String(descricao).trim() : '',
            turmaId: String(turmaId).trim(),
            materiaId: String(materiaId).trim(),
            professorId: req.user ? req.user._id || req.user.id : null,
            professorNome: req.user ? req.user.nome : '',
            bimestre: Number(bimestre),
            tipo: tipo && TIPOS_VALIDOS.includes(tipo) ? tipo : 'Prova',
            peso: peso ? Math.max(0.1, parseFloat(peso)) : 1,
            data: data ? new Date(data) : new Date(),
            escolaId: req.escolaId || null,
            criadoPor: req.user ? req.user._id || req.user.id : null,
        };

        const doc = await Avaliacao.create(novaAvaliacao);

        await AuditoriaService.log({
            req,
            acao: 'CREATE_AVALIACAO',
            recurso: `Turma: ${doc.turmaId} | Matéria: ${doc.materiaId}`,
            recursoId: doc._id || doc.id,
            detalhes: { titulo: doc.titulo, bimestre: doc.bimestre },
        });

        res.status(201).json({ success: true, data: doc });
    } catch (error) {
        res.status(400).json({ success: false, error: error.message });
    }
};

// ----------------------------------------------------------------------------
// PUT /api/avaliacoes-escolares/:id
// ----------------------------------------------------------------------------
exports.update = async (req, res) => {
    try {
        const id = req.params.id;
        const avaliacao = await Avaliacao.findOne({
            $or: [{ _id: id }, { id: id }],
            ...(req.escolaId ? { escolaId: req.escolaId } : {}),
        });

        if (!avaliacao) {
            return res.status(404).json({ success: false, error: 'Avaliação não encontrada.' });
        }

        if (req.user && req.user.perfil === 'professor') {
            const allowed = req.allowedTurmas || [];
            if (!allowed.includes(avaliacao.turmaId)) {
                return res
                    .status(403)
                    .json({ success: false, error: 'Acesso negado para esta avaliação.' });
            }
        }

        const { titulo, descricao, bimestre, tipo, peso, data } = req.body;
        if (titulo !== undefined) avaliacao.titulo = String(titulo).trim();
        if (descricao !== undefined) avaliacao.descricao = String(descricao).trim();
        if (bimestre !== undefined) avaliacao.bimestre = Number(bimestre);
        if (tipo !== undefined && TIPOS_VALIDOS.includes(tipo)) avaliacao.tipo = tipo;
        if (peso !== undefined) avaliacao.peso = Math.max(0.1, parseFloat(peso));
        if (data !== undefined) avaliacao.data = new Date(data);
        if (req.user) avaliacao.atualizadoPor = req.user._id || req.user.id;

        await avaliacao.save();

        res.json({ success: true, data: avaliacao });
    } catch (error) {
        res.status(400).json({ success: false, error: error.message });
    }
};

// ----------------------------------------------------------------------------
// DELETE /api/avaliacoes-escolares/:id
// ----------------------------------------------------------------------------
exports.delete = async (req, res) => {
    try {
        const id = req.params.id;
        const avaliacao = await Avaliacao.findOne({
            $or: [{ _id: id }, { id: id }],
            ...(req.escolaId ? { escolaId: req.escolaId } : {}),
        });

        if (!avaliacao) {
            return res.status(404).json({ success: false, error: 'Avaliação não encontrada.' });
        }

        // Apenas diretor, secretaria ou professor criador
        if (req.user && req.user.perfil === 'professor') {
            const uId = String(req.user._id || req.user.id);
            if (String(avaliacao.professorId) !== uId && String(avaliacao.criadoPor) !== uId) {
                return res.status(403).json({
                    success: false,
                    error: 'Você só pode excluir avaliações criadas por você.',
                });
            }
        }

        // Deletar notas vinculadas
        await Nota.deleteMany({ avaliacaoId: String(avaliacao._id || avaliacao.id) });
        await Avaliacao.deleteOne({ _id: avaliacao._id });

        await AuditoriaService.log({
            req,
            acao: 'DELETE_AVALIACAO',
            recurso: `Avaliação: ${avaliacao.titulo}`,
            recursoId: avaliacao._id,
            detalhes: { turmaId: avaliacao.turmaId, materiaId: avaliacao.materiaId },
        });

        res.json({ success: true, message: 'Avaliação e notas removidas com sucesso.' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};

// ----------------------------------------------------------------------------
// POST /api/avaliacoes-escolares/:id/notas — Lançamento e Edição de Notas em Lote
// ----------------------------------------------------------------------------
exports.lancarNotas = async (req, res) => {
    try {
        const id = req.params.id;
        const avaliacao = await Avaliacao.findOne({
            $or: [{ _id: id }, { id: id }],
            ...(req.escolaId ? { escolaId: req.escolaId } : {}),
        });

        if (!avaliacao) {
            return res.status(404).json({ success: false, error: 'Avaliação não encontrada.' });
        }

        if (req.user && req.user.perfil === 'professor') {
            const allowed = req.allowedTurmas || [];
            if (!allowed.includes(avaliacao.turmaId)) {
                return res.status(403).json({
                    success: false,
                    error: 'Acesso negado para lançar notas nesta turma.',
                });
            }
        }

        const { notas, motivo } = req.body;
        if (!Array.isArray(notas)) {
            return res.status(400).json({ success: false, error: 'Lista de notas inválida.' });
        }

        const avaliacaoIdStr = String(avaliacao._id || avaliacao.id);
        const resultados = [];
        const historicoRegistros = [];

        // Buscar alunos para garantir integridade e nome no histórico
        const alunoIds = notas.map((n) => n.alunoId).filter(Boolean);
        const alunos = await Aluno.find({
            $or: [{ id: { $in: alunoIds } }, { _id: { $in: alunoIds } }],
        })
            .select('id _id nome')
            .lean();

        const alunosMap = {};
        alunos.forEach((a) => {
            if (a.id) alunosMap[String(a.id)] = a.nome;
            if (a._id) alunosMap[String(a._id)] = a.nome;
        });

        // Buscar notas existentes para comparação de auditoria
        const notasExistentes = await Nota.find({
            avaliacaoId: avaliacaoIdStr,
            alunoId: { $in: alunoIds },
        }).lean();

        const notasExistentesMap = {};
        notasExistentes.forEach((n) => {
            notasExistentesMap[String(n.alunoId)] = n;
        });

        for (const item of notas) {
            if (!item.alunoId) continue;

            const check = validarNota(item.nota);
            if (!check.valido) {
                return res.status(400).json({
                    success: false,
                    error: `Nota do aluno ${alunosMap[item.alunoId] || item.alunoId}: ${check.msg}`,
                });
            }

            const presente = item.presente !== false;
            const notaFinal = presente ? check.valor : 0;
            const status = calcularStatus(notaFinal, presente);
            const observacoes = item.observacoes ? String(item.observacoes).trim() : '';

            const notaAntiga = notasExistentesMap[String(item.alunoId)];

            if (notaAntiga) {
                // Atualização
                const mudouNota = notaAntiga.nota !== notaFinal;
                const mudouPresenca = (notaAntiga.presente !== false) !== presente;

                if (mudouNota || mudouPresenca) {
                    historicoRegistros.push({
                        escolaId: req.escolaId || null,
                        avaliacaoId: avaliacaoIdStr,
                        notaId: String(notaAntiga._id || notaAntiga.id),
                        alunoId: String(item.alunoId),
                        alunoNome: alunosMap[String(item.alunoId)] || 'Aluno',
                        notaAnterior: notaAntiga.nota,
                        notaNova: notaFinal,
                        presenteAnterior: notaAntiga.presente !== false,
                        presenteNovo: presente,
                        motivo: motivo ? String(motivo).trim() : 'Atualização de nota',
                        alteradoPorId: req.user ? String(req.user._id || req.user.id) : 'sistema',
                        alteradoPorNome: req.user ? req.user.nome : 'Sistema',
                        alteradoPorPerfil: req.user ? req.user.perfil : '',
                        dataAlteracao: new Date(),
                    });
                }

                const docAtualizado = await Nota.findByIdAndUpdate(
                    notaAntiga._id,
                    {
                        nota: notaFinal,
                        presente,
                        observacoes,
                        status,
                        atualizadoPor: req.user ? String(req.user._id || req.user.id) : null,
                        data: avaliacao.data || new Date(),
                    },
                    { new: true }
                );
                resultados.push(docAtualizado);
            } else {
                // Criação da nota
                const novoDoc = await Nota.create({
                    escolaId: req.escolaId || null,
                    avaliacaoId: avaliacaoIdStr,
                    alunoId: String(item.alunoId),
                    turmaId: avaliacao.turmaId,
                    materiaId: avaliacao.materiaId,
                    bimestre: avaliacao.bimestre,
                    tipo: avaliacao.tipo,
                    nota: notaFinal,
                    presente,
                    observacoes,
                    status,
                    data: avaliacao.data || new Date(),
                    criadoPor: req.user ? String(req.user._id || req.user.id) : null,
                });
                resultados.push(novoDoc);
            }
        }

        // Grava histórico de auditoria se houver alterações
        if (historicoRegistros.length > 0) {
            await AvaliacaoHistorico.insertMany(historicoRegistros);
        }

        await AuditoriaService.log({
            req,
            acao: 'LANCAR_NOTAS_AVALIACAO',
            recurso: `Avaliação ID: ${avaliacaoIdStr}`,
            recursoId: avaliacaoIdStr,
            detalhes: {
                totalProcessado: resultados.length,
                totalHistorico: historicoRegistros.length,
                motivo: motivo || 'Lançamento regular',
            },
        });

        res.json({
            success: true,
            message: 'Notas lançadas com sucesso!',
            processados: resultados.length,
            alteracoesAuditoria: historicoRegistros.length,
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};

// ----------------------------------------------------------------------------
// GET /api/avaliacoes-escolares/:id/historico
// ----------------------------------------------------------------------------
exports.historico = async (req, res) => {
    try {
        const id = req.params.id;
        const historico = await AvaliacaoHistorico.find({
            avaliacaoId: id,
            ...(req.escolaId ? { escolaId: req.escolaId } : {}),
        })
            .sort({ dataAlteracao: -1 })
            .limit(100)
            .lean();

        res.json({ success: true, data: historico });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};
