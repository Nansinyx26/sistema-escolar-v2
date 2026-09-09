const Aluno = require('../models/Aluno');
const Autorizacao = require('../models/Autorizacao');
const logger = require('../utils/logger');

/**
 * Normaliza o identificador para comparação consistente
 */
function normalizeId(id) {
    return id ? String(id).trim() : '';
}

/**
 * Determina o nome do responsável a partir dos dados do aluno
 */
function obterDadosResponsavel(aluno, autorizacoesDoAluno = []) {
    // 1. Se houver autorizações registradas com nome do responsável
    const authComNome = autorizacoesDoAluno.find((a) => a.responsavelNome);
    if (authComNome?.responsavelNome) {
        return {
            nome: authComNome.responsavelNome,
            email: authComNome.responsavelEmail || '',
            telefone: '',
            parentesco: 'Responsável',
        };
    }

    // 2. Array de responsáveis
    if (Array.isArray(aluno.responsaveis) && aluno.responsaveis.length > 0) {
        const principal = aluno.responsaveis[0];
        return {
            nome: principal.nome || 'Não informado',
            email: principal.email || '',
            telefone: principal.telefone || principal.whatsapp || '',
            parentesco: principal.tipo || principal.parentesco || 'Responsável',
        };
    }

    // 3. Objeto responsavelDados
    if (aluno.responsavelDados && typeof aluno.responsavelDados === 'object') {
        return {
            nome: aluno.responsavelDados.nome || aluno.responsavel || 'Não informado',
            email: aluno.responsavelDados.email || '',
            telefone: aluno.responsavelDados.telefone || aluno.responsavelDados.whatsapp || '',
            parentesco: aluno.responsavelDados.parentesco || 'Responsável',
        };
    }

    // 4. Campo legada responsavel (string)
    return {
        nome: aluno.responsavel || 'Não informado',
        email: '',
        telefone: aluno.telefone || '',
        parentesco: 'Responsável',
    };
}

/**
 * Consolida as autorizações de um aluno cruzando a coleção Autorizacao
 * e o subdocumento Aluno.autorizacoesEscolares como fallback.
 */
function consolidarAutorizacoesAluno(aluno, autorizacoesColecao = []) {
    const mapaColecao = new Map();
    autorizacoesColecao.forEach((a) => {
        if (a.tipoAutorizacao) {
            mapaColecao.set(a.tipoAutorizacao, a);
        }
    });

    const embutidas = aluno.autorizacoesEscolares || {};
    const lista = [];
    let aceitas = 0;
    let naoAceitas = 0;
    let pendentes = 0;
    let ultimaData = aluno.updatedAt || aluno.createdAt || new Date();

    Autorizacao.TIPOS_AUTORIZACAO.forEach((tipo) => {
        const meta = Autorizacao.METADADOS_AUTORIZACOES[tipo] || {};
        let aceita = null;
        let dataResposta = null;
        let atualizadoEm = null;
        let detalhes;

        if (mapaColecao.has(tipo)) {
            const registro = mapaColecao.get(tipo);
            aceita = registro.aceita;
            detalhes = registro.detalhes;
            dataResposta = registro.dataResposta || registro.updatedAt;
            atualizadoEm = registro.atualizadoEm || registro.updatedAt;
        } else if (embutidas[tipo] !== undefined && embutidas[tipo] !== null) {
            aceita = Boolean(embutidas[tipo]);
            dataResposta = aluno.updatedAt;
            atualizadoEm = aluno.updatedAt;

            if (
                tipo === 'conducaoEscolar' &&
                (embutidas.motoristaNome || embutidas.motoristaTelefone)
            ) {
                detalhes = {
                    motoristaNome: embutidas.motoristaNome || '',
                    motoristaTelefone: embutidas.motoristaTelefone || '',
                };
            } else if (
                tipo === 'antitermico' &&
                (embutidas.medicamentoNome || embutidas.medicamentoDose)
            ) {
                detalhes = {
                    medicamentoNome: embutidas.medicamentoNome || '',
                    medicamentoDose: embutidas.medicamentoDose || '',
                };
            }
        }

        if (aceita === true) {
            aceitas++;
        } else if (aceita === false) {
            naoAceitas++;
        } else {
            pendentes++;
        }

        if (atualizadoEm && new Date(atualizadoEm) > new Date(ultimaData)) {
            ultimaData = atualizadoEm;
        }

        lista.push({
            tipo,
            titulo: meta.titulo || tipo,
            descricao: meta.descricao || '',
            aceita,
            status: aceita === true ? 'aceita' : aceita === false ? 'recusada' : 'pendente',
            detalhes,
            dataResposta,
            atualizadoEm,
        });
    });

    let statusGeral = 'pendente';
    if (aceitas === Autorizacao.TIPOS_AUTORIZACAO.length) {
        statusGeral = 'todas_aceitas';
    } else if (naoAceitas > 0) {
        statusGeral = 'com_recusas';
    } else if (aceitas > 0) {
        statusGeral = 'parcial';
    }

    return {
        autorizacoes: lista,
        aceitas,
        naoAceitas,
        pendentes,
        statusGeral,
        ultimaAtualizacao: ultimaData,
    };
}

/**
 * GET /api/secretaria/autorizacoes
 * Lista todos os alunos da escola com resumo de autorizações e KPIs consolidados
 */
exports.listarAutorizacoes = async (req, res) => {
    try {
        const escolaId =
            req.escolaId || req.headers['x-escola-id'] || req.query.escolaId || req.user?.escolaId;

        const filtro = {};
        if (escolaId) {
            filtro.escolaId = String(escolaId);
        } else if (req.user?.perfil !== 'admin') {
            return res
                .status(400)
                .json({ success: false, error: 'Escola não identificada no contexto da sessão.' });
        }

        // Busca alunos da escola
        const alunos = await Aluno.find(filtro)
            .select(
                '_id id nome sobrenome turma turmaId matricula responsavel responsaveis responsavelDados autorizacoesEscolares updatedAt createdAt'
            )
            .sort({ nome: 1 })
            .lean();

        // Busca todas as autorizações gravadas na coleção para a escola
        const autorizacoesDocs = await Autorizacao.find(filtro).lean();

        // Agrupa autorizações por alunoId
        const mapaPorAluno = new Map();
        autorizacoesDocs.forEach((auth) => {
            const key = normalizeId(auth.alunoId);
            if (!mapaPorAluno.has(key)) {
                mapaPorAluno.set(key, []);
            }
            mapaPorAluno.get(key).push(auth);
        });

        let totalAceitas = 0;
        let totalNaoAceitas = 0;
        let totalPendentes = 0;
        const turmasSet = new Set();

        const listaAlunos = alunos.map((aluno) => {
            const idPrimario = normalizeId(aluno._id);
            const idLegado = normalizeId(aluno.id);
            const authsDoAluno = mapaPorAluno.get(idPrimario) || mapaPorAluno.get(idLegado) || [];

            const dadosResp = obterDadosResponsavel(aluno, authsDoAluno);
            const consolidado = consolidarAutorizacoesAluno(aluno, authsDoAluno);

            totalAceitas += consolidado.aceitas;
            totalNaoAceitas += consolidado.naoAceitas;
            if (
                consolidado.pendentes > 0 ||
                (consolidado.aceitas === 0 && consolidado.naoAceitas === 0)
            ) {
                totalPendentes++;
            }

            const turma = aluno.turma || aluno.turmaId || 'Sem Turma';
            turmasSet.add(turma);

            return {
                id: aluno._id || aluno.id,
                alunoId: aluno._id || aluno.id,
                nome: [aluno.nome, aluno.sobrenome].filter(Boolean).join(' '),
                turma,
                matricula: aluno.matricula || '',
                responsavel: dadosResp.nome,
                responsavelEmail: dadosResp.email,
                responsavelTelefone: dadosResp.telefone,
                aceitas: consolidado.aceitas,
                naoAceitas: consolidado.naoAceitas,
                pendentes: consolidado.pendentes,
                statusGeral: consolidado.statusGeral,
                ultimaAtualizacao: consolidado.ultimaAtualizacao,
            };
        });

        const totalRespondidas = totalAceitas + totalNaoAceitas;
        const percentualAceitacao =
            totalRespondidas > 0 ? Math.round((totalAceitas / totalRespondidas) * 100) : 0;

        const turmas = Array.from(turmasSet).sort((a, b) =>
            a.localeCompare(b, 'pt-BR', { numeric: true })
        );

        return res.json({
            success: true,
            kpis: {
                totalAlunos: alunos.length,
                totalAceitas,
                totalNaoAceitas,
                percentualAceitacao,
                totalPendentes,
            },
            turmas,
            alunos: listaAlunos,
            consultadoEm: new Date().toISOString(),
        });
    } catch (err) {
        logger.error('Erro em listarAutorizacoes', { error: err.message });
        return res
            .status(500)
            .json({ success: false, error: 'Erro interno ao consultar autorizações dos alunos.' });
    }
};

/**
 * GET /api/secretaria/autorizacoes/aluno/:id
 * Detalha todas as autorizações de um estudante específico
 */
exports.detalhesAutorizacoesAluno = async (req, res) => {
    try {
        const escolaId =
            req.escolaId || req.headers['x-escola-id'] || req.query.escolaId || req.user?.escolaId;
        const { id } = req.params;

        if (!id) {
            return res.status(400).json({ success: false, error: 'ID do aluno é obrigatório.' });
        }

        const filtroAluno = { $or: [{ _id: id }, { id: id }] };
        if (escolaId) {
            filtroAluno.escolaId = String(escolaId);
        } else if (req.user?.perfil !== 'admin') {
            return res
                .status(400)
                .json({ success: false, error: 'Escola não identificada no contexto da sessão.' });
        }

        const aluno = await Aluno.findOne(filtroAluno).lean();

        if (!aluno) {
            return res
                .status(404)
                .json({ success: false, error: 'Aluno não encontrado nesta escola.' });
        }

        const filtroAuth = {
            alunoId: { $in: [aluno._id, aluno.id, String(aluno._id), String(aluno.id)] },
        };
        if (escolaId) filtroAuth.escolaId = String(escolaId);

        const authsDoAluno = await Autorizacao.find(filtroAuth).lean();

        const dadosResp = obterDadosResponsavel(aluno, authsDoAluno);
        const consolidado = consolidarAutorizacoesAluno(aluno, authsDoAluno);

        return res.json({
            success: true,
            aluno: {
                id: aluno._id || aluno.id,
                nome: [aluno.nome, aluno.sobrenome].filter(Boolean).join(' '),
                turma: aluno.turma || aluno.turmaId || 'Sem Turma',
                matricula: aluno.matricula || '',
            },
            responsavel: dadosResp,
            autorizacoes: consolidado.autorizacoes,
            resumo: {
                aceitas: consolidado.aceitas,
                naoAceitas: consolidado.naoAceitas,
                pendentes: consolidado.pendentes,
                statusGeral: consolidado.statusGeral,
                ultimaAtualizacao: consolidado.ultimaAtualizacao,
            },
            consultadoEm: new Date().toISOString(),
        });
    } catch (err) {
        logger.error('Erro em detalhesAutorizacoesAluno', {
            error: err.message,
            alunoId: req.params.id,
        });
        return res
            .status(500)
            .json({ success: false, error: 'Erro ao carregar detalhes das autorizações.' });
    }
};
