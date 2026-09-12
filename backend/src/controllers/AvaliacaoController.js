/**
 * AvaliacaoController.js
 * ============================================================================
 * Gestão completa de Avaliações Escolares e Lançamento de Notas com:
 *  - Turma e disciplina validadas contra o que a escola tem no banco
 *    (services/avaliacoes/estruturaEscolar.js), gravadas na grafia canônica
 *  - Validação de intervalo de nota 0 até o valor da avaliação (máx. 10)
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
const estrutura = require('../services/avaliacoes/estruturaEscolar');
const logger = require('../utils/logger');
const obs = require('../observability');

const TIPOS_VALIDOS = [
    'Prova',
    'Trabalho',
    'Seminário',
    'Redação',
    'Simulado',
    'Atividade',
    'Outro',
];

// Escala do sistema: nota de 0 a 10. Avaliação sem `valor` (anterior ao campo) vale 10.
const VALOR_MAXIMO = 10;
const PERFIS_GESTAO = ['admin', 'diretor', 'secretaria'];

function valorDa(avaliacao) {
    const v = Number(avaliacao?.valor);
    return Number.isFinite(v) && v > 0 ? v : VALOR_MAXIMO;
}

// Validador de nota: 0 até o valor da avaliação
function validarNota(valor, maximo = VALOR_MAXIMO) {
    if (valor === null || valor === undefined || valor === '') {
        return { valido: true, valor: null };
    }
    const n = parseFloat(valor);
    if (Number.isNaN(n) || n < 0 || n > maximo) {
        const teto = String(maximo).replace('.', ',');
        return { valido: false, msg: `A nota deve ser um número entre 0 e ${teto}.` };
    }
    return { valido: true, valor: Math.round(n * 10) / 10 };
}

/**
 * Status pedagógico. Os cortes (6,0 aprovado · 4,0 recuperação) são da escala
 * 0–10; numa avaliação que vale menos, compara-se a proporção.
 */
function calcularStatus(nota, presente, maximo = VALOR_MAXIMO) {
    if (presente === false) return 'Reprovado';
    if (nota === null || nota === undefined) return 'Pendente';
    const naEscala = (nota / maximo) * VALOR_MAXIMO;
    if (naEscala >= 6.0) return 'Aprovado';
    if (naEscala >= 4.0) return 'Recuperação';
    return 'Reprovado';
}

// ─── Helpers de contexto ────────────────────────────────────────────────────

function idDoUsuario(req) {
    return req.user ? String(req.user._id || req.user.id) : null;
}

function ehProfessor(req) {
    return req.user?.perfil === 'professor';
}

/** Turmas do professor (vindas do `horizontalFilter`), já na grafia canônica. */
function turmasDoProfessor(req) {
    return estrutura.canonizarLista(req.allowedTurmas || []);
}

function professorLecionaNaTurma(req, turmaId) {
    const turma = estrutura.canonizarTurma(turmaId);
    if (turma) return turmasDoProfessor(req).some((t) => t.id === turma.id);
    return (req.allowedTurmas || []).includes(turmaId);
}

/** Professor responde pela avaliação que é dele (responsável ou autor). */
function ehDoProfessor(req, avaliacao) {
    const uId = idDoUsuario(req);
    return (
        Boolean(uId) &&
        (String(avaliacao.professorId) === uId || String(avaliacao.criadoPor) === uId)
    );
}

function podeGerenciar(req, avaliacao) {
    if (PERFIS_GESTAO.includes(req.user?.perfil)) return true;
    return ehProfessor(req) && ehDoProfessor(req, avaliacao);
}

function filtroPorId(req, id) {
    return {
        $or: [{ _id: id }, { id: id }],
        ...(req.escolaId ? { escolaId: req.escolaId } : {}),
    };
}

/**
 * "2026-03-20" vira meio-dia UTC do dia 20. Meia-noite UTC — o que
 * `new Date('2026-03-20')` produz — é o dia 19 às 21h no horário de Brasília,
 * e a tabela mostrava a avaliação um dia antes.
 */
function dataCivil(valor) {
    if (valor === null || valor === undefined || valor === '') return null;
    const texto = String(valor).trim();
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(texto);
    const data = m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], 12)) : new Date(texto);
    return Number.isNaN(data.getTime()) ? undefined : data;
}

function lerValor(bruto) {
    if (bruto === undefined || bruto === null || bruto === '') return { ok: true, valor: null };
    const n = Number(String(bruto).replace(',', '.'));
    if (!Number.isFinite(n) || n <= 0 || n > VALOR_MAXIMO) {
        return { ok: false, msg: 'O valor da avaliação deve ser maior que 0 e no máximo 10.' };
    }
    return { ok: true, valor: Math.round(n * 100) / 100 };
}

/**
 * Turma, disciplina e professor responsável de uma avaliação — os três campos
 * que dependem do que a escola tem no banco. Devolve `{ erro, status }` quando
 * algo não confere.
 */
async function resolverVinculos(req, { turmaId, materiaId, professorId }) {
    const turma = estrutura.canonizarTurma(turmaId);
    if (!turma) {
        return { status: 400, erro: 'Turma inválida. Selecione uma turma da lista.' };
    }

    if (ehProfessor(req)) {
        if (!professorLecionaNaTurma(req, turmaId)) {
            return {
                status: 403,
                erro: `Acesso negado. Você não leciona para a turma ${turma.nome}.`,
            };
        }
    } else {
        const turmas = await estrutura.turmasDaEscola(req.escolaId);
        if (!turmas.some((t) => t.id === turma.id)) {
            return { status: 400, erro: `A turma ${turma.nome} não está cadastrada nesta escola.` };
        }
    }

    const disciplinas = await estrutura.disciplinasDaEscola(req.escolaId);
    const disciplina = estrutura.resolverDisciplina(disciplinas, materiaId);
    if (!disciplina) {
        return {
            status: 400,
            erro: 'Disciplina não cadastrada. Selecione uma disciplina da lista.',
        };
    }

    let professor = null;
    if (ehProfessor(req)) {
        const docente = await estrutura.docenteDoUsuario(idDoUsuario(req));
        const permitidas = estrutura.disciplinasDoDocente(docente, disciplinas);
        if (!permitidas.some((d) => d.id === disciplina.id)) {
            return {
                status: 403,
                erro: `Acesso negado. ${disciplina.nome} não está entre as suas disciplinas.`,
            };
        }
        professor = { id: idDoUsuario(req), nome: docente?.nome || req.user.nome || '' };
    } else {
        const docentes = await estrutura.docentesDaEscola(req.escolaId);
        if (professorId) {
            const escolhido = docentes.find((d) => d.id === String(professorId));
            if (!escolhido) {
                return { status: 400, erro: 'Professor responsável não pertence a esta escola.' };
            }
            professor = { id: escolhido.id, nome: escolhido.nome };
        } else {
            const sugerido = estrutura.professorResponsavel(docentes, turma.id, disciplina.nome);
            if (sugerido) professor = { id: sugerido.id, nome: sugerido.nome };
        }
    }

    return { turma, disciplina, professor };
}

// ----------------------------------------------------------------------------
// GET /api/avaliacoes-escolares/opcoes — turmas, disciplinas e docentes do formulário
// ----------------------------------------------------------------------------
exports.opcoes = async (req, res) => {
    try {
        const perfil = req.user?.perfil || '';
        const { disciplinas, turmas, professores, disciplinasPermitidas } = await obs.withSpan(
            'avaliacao.opcoes',
            { 'usuario.perfil': perfil },
            async (span) => {
                const todas = await estrutura.disciplinasDaEscola(req.escolaId);
                let resultado;
                if (ehProfessor(req)) {
                    const docente = await estrutura.docenteDoUsuario(idDoUsuario(req));
                    resultado = {
                        turmas: turmasDoProfessor(req),
                        professores: docente ? [docente] : [],
                        disciplinasPermitidas: estrutura.disciplinasDoDocente(docente, todas),
                    };
                } else {
                    const [turmasDaEscola, docentes] = await Promise.all([
                        estrutura.turmasDaEscola(req.escolaId),
                        estrutura.docentesDaEscola(req.escolaId),
                    ]);
                    resultado = {
                        turmas: turmasDaEscola,
                        professores: docentes,
                        disciplinasPermitidas: todas,
                    };
                }
                span.setAttribute('avaliacao.turmas', resultado.turmas.length);
                span.setAttribute('avaliacao.disciplinas', resultado.disciplinasPermitidas.length);
                return { disciplinas: todas, ...resultado };
            }
        );

        res.json({
            success: true,
            data: {
                perfil,
                usuarioId: idDoUsuario(req),
                turmas,
                series: estrutura.agruparPorSerie(turmas),
                disciplinas: disciplinasPermitidas,
                // Todas as da escola, para exibir o nome de avaliações já gravadas.
                todasDisciplinas: disciplinas,
                professores,
                tiposAvaliacao: TIPOS_VALIDOS,
                valorMaximo: VALOR_MAXIMO,
            },
        });
    } catch (error) {
        logger.error('Falha ao montar opções de avaliação', {
            err: error,
            action: 'avaliacao.opcoes',
        });
        obs.captureException(error, { rota: 'GET /api/avaliacoes-escolares/opcoes' });
        res.status(500).json({
            success: false,
            error: 'Não foi possível carregar turmas e disciplinas.',
        });
    }
};

// ----------------------------------------------------------------------------
// GET /api/avaliacoes-escolares
// ----------------------------------------------------------------------------
exports.list = async (req, res) => {
    try {
        const filters = {};
        if (req.escolaId) filters.escolaId = req.escolaId;
        if (req.query.turmaId)
            filters.turmaId = { $in: estrutura.grafiasDaTurma(req.query.turmaId) };
        if (req.query.bimestre) filters.bimestre = Number(req.query.bimestre);

        // Avaliação antiga pode ter gravado "Português" onde hoje o id é outro:
        // o filtro pega todas as grafias gravadas que são a mesma disciplina.
        const disciplinas = await estrutura.disciplinasDaEscola(req.escolaId);
        if (req.query.materiaId) {
            const alvo = estrutura.resolverDisciplina(disciplinas, req.query.materiaId);
            if (alvo) {
                const gravadas = await Avaliacao.distinct(
                    'materiaId',
                    req.escolaId ? { escolaId: req.escolaId } : {}
                );
                const equivalentes = gravadas.filter(
                    (m) => estrutura.resolverDisciplina(disciplinas, m)?.id === alvo.id
                );
                filters.materiaId = { $in: [...new Set([alvo.id, ...equivalentes])] };
            } else {
                filters.materiaId = req.query.materiaId;
            }
        }

        // Isolamento horizontal para professor
        if (ehProfessor(req)) {
            if (req.query.turmaId && !professorLecionaNaTurma(req, req.query.turmaId)) {
                return res
                    .status(403)
                    .json({ success: false, error: 'Acesso negado para esta turma.' });
            }
            if (!req.query.turmaId) {
                const grafias = turmasDoProfessor(req).flatMap((t) =>
                    estrutura.grafiasDaTurma(t.id)
                );
                filters.turmaId = { $in: [...new Set([...grafias, ...(req.allowedTurmas || [])])] };
            }
        }

        const avaliacoes = await Avaliacao.find(filters).sort({ data: -1, createdAt: -1 }).lean();

        // Enriquecer com contagem de notas lançadas e média prévia. Ausente não
        // entra na média: o lançamento grava 0 para ele, e contá-lo derrubava a
        // média da tabela para um número diferente do mostrado no modal.
        const avaliacaoIds = avaliacoes.map((a) => String(a._id || a.id));
        const notasAgg = await Nota.aggregate([
            { $match: { avaliacaoId: { $in: avaliacaoIds } } },
            {
                $group: {
                    _id: '$avaliacaoId',
                    // Aluno "pendente" também vira documento (nota vazia) ao salvar a
                    // turma inteira; lançada é nota preenchida ou ausência registrada.
                    totalNotas: {
                        $sum: {
                            $cond: [
                                {
                                    $or: [
                                        { $eq: ['$presente', false] },
                                        { $ne: [{ $ifNull: ['$nota', null] }, null] },
                                    ],
                                },
                                1,
                                0,
                            ],
                        },
                    },
                    aprovados: { $sum: { $cond: [{ $eq: ['$status', 'Aprovado'] }, 1, 0] } },
                    media: {
                        $avg: { $cond: [{ $eq: ['$presente', false] }, null, '$nota'] },
                    },
                },
            },
        ]);

        const notasMap = {};
        notasAgg.forEach((agg) => {
            notasMap[agg._id] = {
                totalNotas: agg.totalNotas,
                aprovados: agg.aprovados,
                media: typeof agg.media === 'number' ? Math.round(agg.media * 10) / 10 : null,
            };
        });

        const data = avaliacoes.map((a) => {
            const key = String(a._id || a.id);
            const turma = estrutura.canonizarTurma(a.turmaId);
            return {
                ...a,
                id: a._id || a.id,
                turmaNome: a.turmaNome || turma?.nome || a.turmaId,
                serie: a.serie || turma?.serie || null,
                materiaNome:
                    a.materiaNome ||
                    estrutura.resolverDisciplina(disciplinas, a.materiaId)?.nome ||
                    a.materiaId,
                valor: valorDa(a),
                totalNotas: notasMap[key]?.totalNotas || 0,
                totalAprovados: notasMap[key]?.aprovados || 0,
                mediaTurma: notasMap[key]?.media ?? null,
                podeGerenciar: podeGerenciar(req, a),
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
        const avaliacao = await Avaliacao.findOne(filtroPorId(req, req.params.id)).lean();

        if (!avaliacao) {
            return res.status(404).json({ success: false, error: 'Avaliação não encontrada.' });
        }

        // Validação horizontal para professor
        if (ehProfessor(req) && !professorLecionaNaTurma(req, avaliacao.turmaId)) {
            return res
                .status(403)
                .json({ success: false, error: 'Acesso negado para esta turma.' });
        }

        // Buscar alunos da turma, em qualquer grafia gravada ("1A", "1ºA"...)
        const grafias = estrutura.grafiasDaTurma(avaliacao.turmaId);
        const alunos = await Aluno.find({
            $or: [{ turma: { $in: grafias } }, { turmaId: { $in: grafias } }],
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

        const maximo = valorDa(avaliacao);

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
                status = calcularStatus(notaValor, presente, maximo);

                if (presente && notaValor !== null) {
                    somaNotas += notaValor;
                    contComNota++;
                    contAvaliados++;
                    if (maiorNota === null || notaValor > maiorNota) maiorNota = notaValor;
                    if (menorNota === null || notaValor < menorNota) menorNota = notaValor;

                    if (status === 'Aprovado') contAprovados++;
                    else if (status === 'Recuperação') contRecuperacao++;
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
        const turma = estrutura.canonizarTurma(avaliacao.turmaId);

        res.json({
            success: true,
            data: {
                ...avaliacao,
                id: avaliacao._id || avaliacao.id,
                turmaNome: avaliacao.turmaNome || turma?.nome || avaliacao.turmaId,
                valor: maximo,
                podeGerenciar: podeGerenciar(req, avaliacao),
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
        const corpo = req.body || {};
        const titulo = String(corpo.titulo || '').trim();
        const bimestre = Number(corpo.bimestre);

        const faltando = [];
        if (!titulo) faltando.push('Título');
        if (!corpo.turmaId) faltando.push('Turma');
        if (!corpo.materiaId) faltando.push('Disciplina');
        if (!corpo.bimestre) faltando.push('Bimestre');
        if (!corpo.data) faltando.push('Data da avaliação');
        if (faltando.length > 0) {
            return res.status(400).json({
                success: false,
                error: `Campos obrigatórios não preenchidos: ${faltando.join(', ')}.`,
            });
        }

        if (!Number.isInteger(bimestre) || bimestre < 1 || bimestre > 4) {
            return res.status(400).json({ success: false, error: 'Bimestre deve ser de 1 a 4.' });
        }

        const data = dataCivil(corpo.data);
        if (!data) {
            return res.status(400).json({ success: false, error: 'Data da avaliação inválida.' });
        }
        const dataEntrega = dataCivil(corpo.dataEntrega);
        if (dataEntrega === undefined) {
            return res.status(400).json({ success: false, error: 'Data de entrega inválida.' });
        }
        if (dataEntrega && dataEntrega < data) {
            return res.status(400).json({
                success: false,
                error: 'A data de entrega não pode ser anterior à data da avaliação.',
            });
        }

        const valor = lerValor(corpo.valor);
        if (!valor.ok) return res.status(400).json({ success: false, error: valor.msg });

        const vinculos = await resolverVinculos(req, corpo);
        if (vinculos.erro) {
            return res.status(vinculos.status).json({ success: false, error: vinculos.erro });
        }
        const { turma, disciplina, professor } = vinculos;

        const novaAvaliacao = {
            titulo,
            descricao: corpo.descricao ? String(corpo.descricao).trim() : '',
            turmaId: turma.id,
            turmaNome: turma.nome,
            serie: turma.serie,
            materiaId: disciplina.id,
            materiaNome: disciplina.nome,
            professorId: professor?.id || null,
            professorNome: professor?.nome || '',
            bimestre,
            tipo: TIPOS_VALIDOS.includes(corpo.tipo) ? corpo.tipo : 'Prova',
            peso: corpo.peso ? Math.max(0.1, parseFloat(corpo.peso)) : 1,
            valor: valor.valor ?? VALOR_MAXIMO,
            data,
            dataEntrega: dataEntrega || null,
            escolaId: req.escolaId || null,
            criadoPor: idDoUsuario(req),
            criadoPorNome: req.user?.nome || '',
            criadoPorPerfil: req.user?.perfil || '',
        };

        // Atributos sem PII: turma, disciplina e bimestre bastam para agrupar.
        const doc = await obs.withSpan(
            'avaliacao.criar',
            {
                'avaliacao.turma': turma.id,
                'avaliacao.disciplina': disciplina.nome,
                'avaliacao.bimestre': bimestre,
            },
            () => Avaliacao.create(novaAvaliacao)
        );

        await AuditoriaService.log({
            req,
            acao: 'CREATE_AVALIACAO',
            recurso: `Turma: ${doc.turmaNome} | Disciplina: ${doc.materiaNome}`,
            recursoId: doc._id || doc.id,
            detalhes: { titulo: doc.titulo, bimestre: doc.bimestre, valor: doc.valor },
        });

        res.status(201).json({ success: true, data: doc });
    } catch (error) {
        logger.error('Falha ao criar avaliação', { err: error, action: 'avaliacao.criar' });
        obs.captureException(error, { rota: 'POST /api/avaliacoes-escolares' });
        res.status(400).json({ success: false, error: error.message });
    }
};

// ----------------------------------------------------------------------------
// PUT /api/avaliacoes-escolares/:id
// ----------------------------------------------------------------------------
exports.update = async (req, res) => {
    try {
        const avaliacao = await Avaliacao.findOne(filtroPorId(req, req.params.id));

        if (!avaliacao) {
            return res.status(404).json({ success: false, error: 'Avaliação não encontrada.' });
        }

        if (ehProfessor(req) && !professorLecionaNaTurma(req, avaliacao.turmaId)) {
            return res
                .status(403)
                .json({ success: false, error: 'Acesso negado para esta avaliação.' });
        }

        const corpo = req.body || {};
        const avaliacaoIdStr = String(avaliacao._id || avaliacao.id);

        // Trocar turma, disciplina ou professor passa pela mesma validação da criação.
        const mudaTurma =
            corpo.turmaId !== undefined &&
            estrutura.canonizarTurma(corpo.turmaId)?.id !==
                estrutura.canonizarTurma(avaliacao.turmaId)?.id;
        const mudaDisciplina =
            corpo.materiaId !== undefined && String(corpo.materiaId) !== avaliacao.materiaId;
        const mudaProfessor =
            !ehProfessor(req) &&
            corpo.professorId !== undefined &&
            String(corpo.professorId || '') !== String(avaliacao.professorId || '');

        if (mudaTurma || mudaDisciplina) {
            // As notas lançadas carregam turma e disciplina; trocá-las depois
            // deixaria notas penduradas numa avaliação que não é mais delas.
            const notasLancadas = await Nota.countDocuments({ avaliacaoId: avaliacaoIdStr });
            if (notasLancadas > 0) {
                return res.status(409).json({
                    success: false,
                    error: 'Esta avaliação já tem notas lançadas: turma e disciplina não podem mais ser alteradas.',
                });
            }
        }

        if (mudaTurma || mudaDisciplina || mudaProfessor) {
            // Gestão que troca só a turma mantém o professor que já tinha
            // escolhido; vazio ("definir automaticamente") pede a sugestão.
            const professorId = mudaProfessor ? corpo.professorId : avaliacao.professorId;
            const vinculos = await resolverVinculos(req, {
                turmaId: mudaTurma ? corpo.turmaId : avaliacao.turmaId,
                materiaId: mudaDisciplina ? corpo.materiaId : avaliacao.materiaId,
                professorId: ehProfessor(req) ? null : professorId,
            });
            if (vinculos.erro) {
                return res.status(vinculos.status).json({ success: false, error: vinculos.erro });
            }
            avaliacao.turmaId = vinculos.turma.id;
            avaliacao.turmaNome = vinculos.turma.nome;
            avaliacao.serie = vinculos.turma.serie;
            avaliacao.materiaId = vinculos.disciplina.id;
            avaliacao.materiaNome = vinculos.disciplina.nome;
            avaliacao.professorId = vinculos.professor?.id || null;
            avaliacao.professorNome = vinculos.professor?.nome || '';
        }

        const { titulo, descricao, bimestre, tipo, peso } = corpo;
        if (titulo !== undefined) {
            if (!String(titulo).trim()) {
                return res.status(400).json({ success: false, error: 'Título é obrigatório.' });
            }
            avaliacao.titulo = String(titulo).trim();
        }
        if (descricao !== undefined) avaliacao.descricao = String(descricao).trim();
        if (bimestre !== undefined) avaliacao.bimestre = Number(bimestre);
        if (tipo !== undefined && TIPOS_VALIDOS.includes(tipo)) avaliacao.tipo = tipo;
        if (peso !== undefined) avaliacao.peso = Math.max(0.1, parseFloat(peso));

        if (corpo.data !== undefined) {
            const data = dataCivil(corpo.data);
            if (!data) {
                return res
                    .status(400)
                    .json({ success: false, error: 'Data da avaliação inválida.' });
            }
            avaliacao.data = data;
        }
        if (corpo.dataEntrega !== undefined) {
            const dataEntrega = dataCivil(corpo.dataEntrega);
            if (dataEntrega === undefined) {
                return res.status(400).json({ success: false, error: 'Data de entrega inválida.' });
            }
            avaliacao.dataEntrega = dataEntrega;
        }
        if (avaliacao.dataEntrega && avaliacao.data && avaliacao.dataEntrega < avaliacao.data) {
            return res.status(400).json({
                success: false,
                error: 'A data de entrega não pode ser anterior à data da avaliação.',
            });
        }

        if (corpo.valor !== undefined) {
            const valor = lerValor(corpo.valor);
            if (!valor.ok) return res.status(400).json({ success: false, error: valor.msg });
            const novoValor = valor.valor ?? VALOR_MAXIMO;
            // Baixar o valor abaixo de uma nota já lançada deixaria essa nota fora da escala.
            const acima = await Nota.findOne({
                avaliacaoId: avaliacaoIdStr,
                nota: { $gt: novoValor },
            }).lean();
            if (acima) {
                return res.status(409).json({
                    success: false,
                    error: `Já existe nota lançada acima de ${String(novoValor).replace('.', ',')}. Ajuste as notas antes de reduzir o valor.`,
                });
            }
            avaliacao.valor = novoValor;
        }

        if (req.user) avaliacao.atualizadoPor = idDoUsuario(req);

        await avaliacao.save();

        res.json({ success: true, data: avaliacao });
    } catch (error) {
        logger.error('Falha ao atualizar avaliação', { err: error, action: 'avaliacao.atualizar' });
        obs.captureException(error, { rota: 'PUT /api/avaliacoes-escolares/:id' });
        res.status(400).json({ success: false, error: error.message });
    }
};

// ----------------------------------------------------------------------------
// DELETE /api/avaliacoes-escolares/:id
// ----------------------------------------------------------------------------
exports.delete = async (req, res) => {
    try {
        const avaliacao = await Avaliacao.findOne(filtroPorId(req, req.params.id));

        if (!avaliacao) {
            return res.status(404).json({ success: false, error: 'Avaliação não encontrada.' });
        }

        // Apenas diretor, secretaria ou o professor responsável/criador
        if (ehProfessor(req) && !ehDoProfessor(req, avaliacao)) {
            return res.status(403).json({
                success: false,
                error: 'Você só pode excluir avaliações criadas por você.',
            });
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
        const avaliacao = await Avaliacao.findOne(filtroPorId(req, req.params.id));

        if (!avaliacao) {
            return res.status(404).json({ success: false, error: 'Avaliação não encontrada.' });
        }

        if (ehProfessor(req) && !professorLecionaNaTurma(req, avaliacao.turmaId)) {
            return res.status(403).json({
                success: false,
                error: 'Acesso negado para lançar notas nesta turma.',
            });
        }

        const { notas, motivo } = req.body;
        if (!Array.isArray(notas)) {
            return res.status(400).json({ success: false, error: 'Lista de notas inválida.' });
        }

        const avaliacaoIdStr = String(avaliacao._id || avaliacao.id);
        const maximo = valorDa(avaliacao);
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

            const check = validarNota(item.nota, maximo);
            if (!check.valido) {
                return res.status(400).json({
                    success: false,
                    error: `Nota do aluno ${alunosMap[item.alunoId] || item.alunoId}: ${check.msg}`,
                });
            }

            const presente = item.presente !== false;
            const notaFinal = presente ? check.valor : 0;
            const status = calcularStatus(notaFinal, presente, maximo);
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
                        alteradoPorId: req.user ? idDoUsuario(req) : 'sistema',
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
                        atualizadoPor: req.user ? idDoUsuario(req) : null,
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
                    criadoPor: req.user ? idDoUsuario(req) : null,
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

        // O histórico expõe nome de aluno e nota: mesma regra de turma do GET /:id.
        if (ehProfessor(req)) {
            const avaliacao = await Avaliacao.findOne(filtroPorId(req, id))
                .select('turmaId')
                .lean();
            if (!avaliacao) {
                return res.status(404).json({ success: false, error: 'Avaliação não encontrada.' });
            }
            if (!professorLecionaNaTurma(req, avaliacao.turmaId)) {
                return res
                    .status(403)
                    .json({ success: false, error: 'Acesso negado para esta turma.' });
            }
        }

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
