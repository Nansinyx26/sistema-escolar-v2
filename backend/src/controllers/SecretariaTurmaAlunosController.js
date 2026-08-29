/**
 * SecretariaTurmaAlunosController — alunos dentro de uma TURMA.
 *
 * Dois caminhos de entrada:
 *   Fluxo A — cadastro/vínculo de um aluno por vez (modal).
 *   Fluxo B — importação em lote a partir do relatório "Relação de Alunos por
 *             Classe" da SEDUC-SP (PDF), ou de planilha XLSX/CSV, com
 *             pré-visualização obrigatória antes de gravar.
 *
 * ─── LGPD: este arquivo processa dado pessoal de criança ─────────────────────
 * Nada de nome, RA ou data de nascimento vai para log. O que é registrado:
 * importacaoId, escolaId, usuarioId, contadores e ÍNDICE da linha com erro —
 * nunca o conteúdo dela. A auditoria (AuditLog) guarda quem, quando, para qual
 * turma, o nome do arquivo, o hash e os contadores. O arquivo enviado é lido em
 * memória e descartado; nunca toca o disco nem storage externo.
 */
const Aluno = require('../models/Aluno');
const Matricula = require('../models/Matricula');
const Turma = require('../models/Turma');
const ImportacaoAlunos = require('../models/ImportacaoAlunos');
const AuditLog = require('../models/AuditLog');
const logger = require('../utils/logger');
const busca = require('../utils/buscaAluno');
const { assignSecretCodes } = require('../utils/secretCodeHelper');
const { emitirParaEscola } = require('../utils/realtime');
const importacao = require('../services/importacaoAlunos');

const { classificador, normalizacao } = importacao;
const { STATUS, STATUS_IMPORTAVEIS } = classificador;

/** Tamanho de cada bloco de operações do bulkWrite (§5.7). */
const TAMANHO_LOTE = 200;

// ═════════════════════════════════════════════════════════════════════════════
// Helpers de escopo — idênticos aos de SecretariaController de propósito.
// Duas regras diferentes de isolamento no mesmo módulo seriam pior do que a
// repetição destas seis linhas.
// ═════════════════════════════════════════════════════════════════════════════

/** Injeta escolaId no filtro quando há tenant resolvido. */
function escopo(req, query = {}) {
    if (req.escolaId && req.user?.perfil !== 'admin') {
        return { ...query, escolaId: String(req.escolaId) };
    }
    return query;
}

/** Valor de escolaId a gravar em documentos novos. */
function escolaAtual(req) {
    return req.escolaId ? String(req.escolaId) : undefined;
}

function usuarioAtual(req) {
    return String(req.user?._id || req.user?.id || '');
}

/**
 * Carrega a turma garantindo que ela pertence à escola da SESSÃO.
 *
 * É esta função que fecha o IDOR do §7.1: sem ela, trocar o `:turmaId` na URL
 * lista — e permite importar para — a turma de outra escola da rede. Devolve
 * null tanto para "não existe" quanto para "é de outra escola", e o handler
 * responde 404 nos dois casos, para não confirmar a existência do registro.
 */
async function carregarTurmaDaEscola(req, turmaId) {
    if (!turmaId) return null;
    return Turma.findOne(escopo(req, { _id: String(turmaId) })).lean();
}

/** Ano letivo do contexto: corpo/query → ano da turma → ano corrente. */
function resolverAnoLetivo(req, turma) {
    const informado = parseInt(req.body?.anoLetivo ?? req.query?.anoLetivo, 10);
    if (Number.isFinite(informado) && informado >= 2000 && informado <= 2100) return informado;
    if (turma && Number.isFinite(turma.ano) && turma.ano >= 2000) return turma.ano;
    return new Date().getFullYear();
}

/** Registra auditoria. Nunca recebe conteúdo de linha — só contadores. */
async function audit(req, acao, recurso, recursoId, detalhes = {}) {
    try {
        await AuditLog.create({
            usuarioId: usuarioAtual(req),
            usuarioNome: req.user?.nome,
            usuarioEmail: req.user?.email,
            perfil: req.user?.perfil,
            acao,
            recurso,
            recursoId: recursoId ? String(recursoId) : undefined,
            escolaId: escolaAtual(req),
            detalhes: {
                descricao: detalhes.descricao,
                valorAnterior: detalhes.anterior,
                valorNovo: detalhes.novo,
            },
            ip: req.ip,
            userAgent: req.get('User-Agent'),
        });
    } catch (e) {
        logger.warn(`[SecretariaTurmaAlunos] auditoria não registrada: ${e.message}`);
    }
}

/** Resposta de erro sem vazar stack trace nem conteúdo do arquivo (§3). */
function falhar(res, status, mensagem, detalhes) {
    const corpo = { success: false, error: mensagem };
    if (detalhes) corpo.detalhes = detalhes;
    return res.status(status).json(corpo);
}

// ═════════════════════════════════════════════════════════════════════════════
// Leitura da turma
// ═════════════════════════════════════════════════════════════════════════════

/** Projeção pública do aluno na lista da turma. */
function alunoParaLista(aluno, matricula) {
    return {
        id: String(aluno._id),
        nome: aluno.nome,
        nomeExibicao: normalizacao.tituloCase(`${aluno.nome || ''} ${aluno.sobrenome || ''}`),
        ra: aluno.matricula || '',
        raDigito: aluno.raDigito || '',
        raUf: aluno.raUf || '',
        nascimento: aluno.nascimento || null,
        nascimentoFormatado: normalizacao.formatarDataBr(aluno.nascimento),
        situacao: aluno.situacao || 'ativo',
        situacaoRotulo: normalizacao.ROTULO_SITUACAO[aluno.situacao || 'ativo'] || 'Ativo',
        possuiDeficiencia: !!aluno.pcd,
        transtornos: aluno.transtornos || [],
        origemCadastro: aluno.origemCadastro || 'manual',
        numeroChamada: matricula ? matricula.numeroChamada || null : null,
        matriculaId: matricula ? String(matricula._id) : null,
        serie: matricula?.serie || '',
    };
}

/**
 * Reúne os alunos de uma turma.
 *
 * Duas fontes, de propósito: `Matricula` é a verdade, mas o sistema carrega
 * anos de alunos vinculados apenas pelo cache legado em `Aluno.turma` /
 * `Aluno.turmaId` (ver o comentário LEGACY no schema). Ignorar o cache faria a
 * tela nova aparecer VAZIA para turmas que estão cheias — e a secretaria
 * reimportaria tudo, duplicando aluno.
 */
async function reunirAlunosDaTurma(req, turma, anoLetivo) {
    const matriculas = await Matricula.find(
        escopo(req, {
            turmaId: String(turma._id),
            anoLetivo,
            status: { $nin: ['transferido', 'evadido'] },
        })
    ).lean();

    const porAlunoId = new Map(matriculas.map((m) => [String(m.alunoId), m]));

    const filtroLegado = {
        $or: [
            { turmaId: String(turma._id) },
            ...(turma.nome ? [{ turma: turma.nome }] : []),
            ...(turma.id ? [{ turma: turma.id }] : []),
        ],
        ativo: true,
    };

    const idsMatriculados = [...porAlunoId.keys()];
    const alunos = await Aluno.find(
        escopo(req, {
            $or: [
                ...(idsMatriculados.length ? [{ _id: { $in: idsMatriculados } }] : []),
                filtroLegado,
            ],
        })
    ).lean();

    return alunos
        .map((aluno) => alunoParaLista(aluno, porAlunoId.get(String(aluno._id))))
        .sort((a, b) => {
            if (a.numeroChamada && b.numeroChamada) return a.numeroChamada - b.numeroChamada;
            if (a.numeroChamada) return -1;
            if (b.numeroChamada) return 1;
            return a.nome.localeCompare(b.nome, 'pt-BR');
        });
}

// GET /api/secretaria/turmas/:turmaId/alunos
exports.listarAlunosDaTurma = async (req, res) => {
    try {
        const turma = await carregarTurmaDaEscola(req, req.params.turmaId);
        if (!turma) return falhar(res, 404, 'Turma não encontrada.');

        const anoLetivo = resolverAnoLetivo(req, turma);
        const alunos = await reunirAlunosDaTurma(req, turma, anoLetivo);

        res.json({
            success: true,
            data: {
                turma: {
                    id: String(turma._id),
                    nome: turma.nome || turma.id || '',
                    descricao: turma.descricao || '',
                    sala: turma.sala || '',
                    periodo: turma.periodo || '',
                    ano: turma.ano || null,
                },
                anoLetivo,
                total: alunos.length,
                alunos,
            },
        });
    } catch (error) {
        logger.error('[SecretariaTurmaAlunos.listar] falha ao listar alunos da turma', {
            err: error,
            action: 'secretaria.turma.listarAlunos',
        });
        return falhar(res, 500, 'Não foi possível carregar os alunos desta turma.');
    }
};

// GET /api/secretaria/alunos/buscar?q=
// Autocomplete do modal do Fluxo A. Escopado por escola como todo o resto —
// sem isso o campo de busca vira um vazamento de aluno de outra escola.
exports.buscarAlunos = async (req, res) => {
    try {
        const termo = normalizacao.colapsarEspacos(req.query?.q || '');
        const sala = normalizacao.colapsarEspacos(req.query?.turma || req.query?.sala || '');

        // Sem sala, o termo precisa de 3 letras — buscar a escola inteira por
        // uma letra é caro e inútil. Com uma sala escolhida o universo já está
        // recortado, então qualquer termo (inclusive nenhum) vale.
        if (!sala && termo.length < 3) {
            return res.json({ success: true, data: { alunos: [], total: 0 } });
        }

        // `nomeNormalizado` sozinho não bastava: ele só existe nos documentos
        // gravados pelo pre-save do Mongoose. Cadastro legado e escrita por
        // bulkWrite ficam sem o campo, e o aluno simplesmente não aparecia na
        // secretaria mesmo estando no banco. `filtroDeBusca` procura também em
        // `nome`, `sobrenome` e `matricula`, sem acento e em qualquer ordem.
        const filtro = busca.combinar(
            // `ativo: true` estrito escondia todo cadastro antigo em que o campo
            // nem existe. `$ne: false` é o critério usado no resto do sistema.
            escopo(req, { ativo: { $ne: false } }),
            busca.filtroDeBusca(termo),
            busca.filtroDeSala(sala)
        );

        const alunos = await Aluno.find(filtro)
            .select(
                'nome sobrenome matricula raDigito raUf nascimento situacao pcd transtornos turma turmaId'
            )
            .sort({ nome: 1 })
            .limit(20)
            .lean();

        res.json({
            success: true,
            data: {
                total: alunos.length,
                alunos: alunos.map((aluno) => ({
                    id: String(aluno._id),
                    nome: normalizacao.colapsarEspacos(
                        `${aluno.nome || ''} ${aluno.sobrenome || ''}`
                    ),
                    nomeExibicao: normalizacao.tituloCase(
                        `${aluno.nome || ''} ${aluno.sobrenome || ''}`
                    ),
                    ra: aluno.matricula || '',
                    raDigito: aluno.raDigito || '',
                    raUf: aluno.raUf || 'SP',
                    nascimento: aluno.nascimento || null,
                    nascimentoFormatado: normalizacao.formatarDataBr(aluno.nascimento),
                    situacao: aluno.situacao || 'ativo',
                    possuiDeficiencia: !!aluno.pcd,
                    transtornos: aluno.transtornos || [],
                    turmaAtual: aluno.turma || '',
                })),
            },
        });
    } catch (error) {
        logger.error('[SecretariaTurmaAlunos.buscar] falha na busca de alunos', {
            err: error,
            action: 'secretaria.alunos.buscar',
        });
        return falhar(res, 500, 'Não foi possível buscar alunos agora.');
    }
};

// ═════════════════════════════════════════════════════════════════════════════
// FLUXO A — adicionar um aluno
// ═════════════════════════════════════════════════════════════════════════════

/** Próximo número de chamada livre na turma. */
async function proximoNumeroChamada(req, turmaId, anoLetivo) {
    const ultima = await Matricula.findOne(escopo(req, { turmaId: String(turmaId), anoLetivo }))
        .sort({ numeroChamada: -1 })
        .select('numeroChamada')
        .lean();
    return (ultima?.numeroChamada ? ultima.numeroChamada : 0) + 1;
}

/**
 * Cria (ou reaproveita) a matrícula do aluno na turma.
 * Idempotente: filtra pela chave única `{escolaId, alunoId, anoLetivo}`.
 */
async function vincularATurma(
    req,
    { alunoId, turma, anoLetivo, numeroChamada, serie, importacaoId }
) {
    const filtro = escopo(req, { alunoId: String(alunoId), anoLetivo });
    const existente = await Matricula.findOne({ ...filtro, turmaId: String(turma._id) }).lean();
    if (existente) return { matricula: existente, criada: false, transferida: false };

    const emOutraTurma = await Matricula.findOne(filtro).lean();

    const numero = numeroChamada || (await proximoNumeroChamada(req, turma._id, anoLetivo));
    const atualizacao = {
        $set: {
            turmaId: String(turma._id),
            numeroChamada: numero,
            ...(serie ? { serie } : {}),
            status: 'cursando',
        },
        $setOnInsert: {
            alunoId: String(alunoId),
            anoLetivo,
            escolaId: escolaAtual(req),
            criadoPor: usuarioAtual(req),
            ...(importacaoId ? { importacaoId } : {}),
        },
    };

    await Matricula.updateOne(filtro, atualizacao, { upsert: true });
    const matricula = await Matricula.findOne({ ...filtro, turmaId: String(turma._id) }).lean();

    // Mantém o cache legado do aluno coerente com a matrícula — o resto do
    // sistema (planilha de faltas, notas, grade) ainda lê `Aluno.turma`.
    await Aluno.updateOne(escopo(req, { _id: String(alunoId) }), {
        $set: { turma: turma.nome || turma.id, turmaId: String(turma._id) },
    });

    return { matricula, criada: !emOutraTurma, transferida: !!emOutraTurma };
}

// POST /api/secretaria/turmas/:turmaId/alunos
exports.adicionarAluno = async (req, res) => {
    try {
        const turma = await carregarTurmaDaEscola(req, req.params.turmaId);
        if (!turma) return falhar(res, 404, 'Turma não encontrada.');

        const anoLetivo = resolverAnoLetivo(req, turma);
        const numeroChamada = normalizacao.normalizarNumeroChamada(req.body?.numeroChamada);
        const serie = normalizacao.normalizarSerie(req.body?.serie);

        // ── Caminho 1: vincular aluno JÁ cadastrado ─────────────────────────
        if (req.body?.alunoId) {
            const aluno = await Aluno.findOne(
                escopo(req, { _id: String(req.body.alunoId) })
            ).lean();
            if (!aluno) return falhar(res, 404, 'Aluno não encontrado nesta escola.');

            const jaNaTurma = await Matricula.findOne(
                escopo(req, {
                    alunoId: String(aluno._id),
                    turmaId: String(turma._id),
                    anoLetivo,
                })
            ).lean();
            if (jaNaTurma) {
                return falhar(
                    res,
                    409,
                    'Este aluno já está matriculado nesta turma neste ano letivo.'
                );
            }

            const { matricula } = await vincularATurma(req, {
                alunoId: aluno._id,
                turma,
                anoLetivo,
                numeroChamada,
                serie,
            });

            await audit(req, 'LINK_STUDENT_CLASS', 'Matriculas', matricula?._id, {
                descricao: `Aluno vinculado à turma ${turma.nome || turma._id} (${anoLetivo})`,
            });
            emitirParaEscola(escolaAtual(req), 'turma:alunos_alterados', {
                turmaId: String(turma._id),
                anoLetivo,
            });

            return res.status(201).json({
                success: true,
                data: { vinculado: true, aluno: alunoParaLista(aluno, matricula) },
            });
        }

        // ── Caminho 2: criar aluno novo ─────────────────────────────────────
        const { dados, erros, avisos } = classificador.normalizarRegistro({
            nome: req.body?.nome,
            ra: req.body?.ra,
            raDigito: req.body?.raDigito,
            raUf: req.body?.raUf,
            dataNascimento: req.body?.dataNascimento,
            situacao: req.body?.situacao,
            dataMovimentacao: req.body?.dataMovimentacao,
            deficiencia: req.body?.possuiDeficiencia ? 'Sim' : 'Não',
            transtornos: req.body?.transtornos,
            serie,
            numeroChamada: req.body?.numeroChamada,
        });

        if (erros.length > 0) {
            return falhar(res, 400, 'Confira os dados do aluno.', erros);
        }

        // Duplicata por RA na mesma escola: devolve o alunoId para que o
        // frontend ofereça o VÍNCULO em vez de repetir um erro sem saída.
        const duplicado = await Aluno.findOne(escopo(req, { matricula: dados.ra }))
            .select('nome sobrenome')
            .lean();
        if (duplicado) {
            const nomeDuplicado = normalizacao.tituloCase(
                `${duplicado.nome || ''} ${duplicado.sobrenome || ''}`
            );
            return res.status(409).json({
                success: false,
                error: `Já existe um aluno com este RA nesta escola: ${nomeDuplicado}. Deseja vinculá-lo a esta turma?`,
                codigo: 'RA_DUPLICADO',
                data: { alunoId: String(duplicado._id), nome: nomeDuplicado },
            });
        }

        const aluno = new Aluno({
            escolaId: escolaAtual(req),
            nome: dados.nome,
            nomeNormalizado: dados.nomeNormalizado,
            matricula: dados.ra,
            raDigito: dados.raDigito,
            raUf: dados.raUf,
            nascimento: dados.dataNascimento,
            situacao: dados.situacao,
            dataMovimentacao: dados.dataMovimentacao,
            pcd: dados.possuiDeficiencia,
            transtornos: dados.transtornos.length ? dados.transtornos : undefined,
            origemCadastro: 'manual',
            turma: turma.nome || turma.id,
            turmaId: String(turma._id),
            ativo: true,
        });
        await aluno.save(); // pre-save gera codigoSecreto

        const { matricula } = await vincularATurma(req, {
            alunoId: aluno._id,
            turma,
            anoLetivo,
            numeroChamada: numeroChamada || dados.numeroChamada,
            serie: serie || dados.serie,
        });

        await audit(req, 'CREATE_STUDENT', 'Alunos', aluno._id, {
            descricao: `Aluno cadastrado pela secretaria e vinculado à turma ${turma.nome || turma._id} (${anoLetivo})`,
        });
        emitirParaEscola(escolaAtual(req), 'turma:alunos_alterados', {
            turmaId: String(turma._id),
            anoLetivo,
        });

        return res.status(201).json({
            success: true,
            data: {
                criado: true,
                avisos,
                aluno: {
                    ...alunoParaLista(aluno.toObject(), matricula),
                    codigoSecreto: aluno.codigoSecreto,
                },
            },
        });
    } catch (error) {
        if (error.code === 11000) {
            return falhar(res, 409, 'Já existe um aluno com este RA nesta escola.');
        }
        logger.error('[SecretariaTurmaAlunos.adicionar] falha ao adicionar aluno', {
            err: error,
            action: 'secretaria.turma.adicionarAluno',
        });
        return falhar(res, 500, 'Não foi possível adicionar o aluno.');
    }
};

// DELETE /api/secretaria/turmas/:turmaId/alunos/:alunoId
// Remove o VÍNCULO, não o aluno. Um aluno pode existir na escola sem turma.
exports.removerAlunoDaTurma = async (req, res) => {
    try {
        const turma = await carregarTurmaDaEscola(req, req.params.turmaId);
        if (!turma) return falhar(res, 404, 'Turma não encontrada.');

        const anoLetivo = resolverAnoLetivo(req, turma);
        const aluno = await Aluno.findOne(escopo(req, { _id: String(req.params.alunoId) }))
            .select('_id')
            .lean();
        if (!aluno) return falhar(res, 404, 'Aluno não encontrado nesta escola.');

        const resultado = await Matricula.deleteOne(
            escopo(req, {
                alunoId: String(aluno._id),
                turmaId: String(turma._id),
                anoLetivo,
            })
        );

        // Limpa o cache legado só se ele apontava para ESTA turma.
        await Aluno.updateOne(escopo(req, { _id: String(aluno._id), turmaId: String(turma._id) }), {
            $set: { turma: '', turmaId: '' },
        });

        await audit(req, 'UNLINK_STUDENT_CLASS', 'Matriculas', aluno._id, {
            descricao: `Vínculo com a turma ${turma.nome || turma._id} (${anoLetivo}) removido`,
        });
        emitirParaEscola(escolaAtual(req), 'turma:alunos_alterados', {
            turmaId: String(turma._id),
            anoLetivo,
        });

        return res.json({ success: true, data: { removido: resultado.deletedCount > 0 } });
    } catch (error) {
        logger.error('[SecretariaTurmaAlunos.remover] falha ao remover vínculo', {
            err: error,
            action: 'secretaria.turma.removerAluno',
        });
        return falhar(res, 500, 'Não foi possível remover o aluno da turma.');
    }
};

// ═════════════════════════════════════════════════════════════════════════════
// FLUXO B — importação em lote
// ═════════════════════════════════════════════════════════════════════════════

/** Monta os índices que o classificador precisa, em 2 consultas. */
async function retratoDaEscola(req, turma, anoLetivo, registros) {
    const ras = [...new Set(registros.map((r) => normalizacao.normalizarRa(r.ra)).filter(Boolean))];

    const existentes = ras.length
        ? await Aluno.find(escopo(req, { matricula: { $in: ras } }))
              .select('_id nome sobrenome matricula nascimento')
              .lean()
        : [];

    const alunosPorRa = new Map(existentes.map((aluno) => [String(aluno.matricula), aluno]));

    const matriculas = existentes.length
        ? await Matricula.find(
              escopo(req, {
                  alunoId: { $in: existentes.map((a) => String(a._id)) },
                  anoLetivo,
              })
          )
              .select('alunoId turmaId')
              .lean()
        : [];

    const alunosJaNaTurma = new Set();
    const turmaAtualPorAluno = new Map();
    const idsOutrasTurmas = new Set();

    for (const matricula of matriculas) {
        if (String(matricula.turmaId) === String(turma._id))
            alunosJaNaTurma.add(String(matricula.alunoId));
        else idsOutrasTurmas.add(String(matricula.turmaId));
    }

    // Nome legível das outras turmas, para o aviso de transferência.
    const nomesTurma = idsOutrasTurmas.size
        ? await Turma.find(escopo(req, { _id: { $in: [...idsOutrasTurmas] } }))
              .select('nome id')
              .lean()
        : [];
    const nomePorTurmaId = new Map(nomesTurma.map((t) => [String(t._id), t.nome || t.id || '']));

    for (const matricula of matriculas) {
        if (String(matricula.turmaId) === String(turma._id)) continue;
        turmaAtualPorAluno.set(String(matricula.alunoId), {
            turmaId: String(matricula.turmaId),
            turmaNome: nomePorTurmaId.get(String(matricula.turmaId)) || '',
        });
    }

    return { alunosPorRa, alunosJaNaTurma, turmaAtualPorAluno };
}

/** Forma pública de uma sessão de importação (o que a tela consome). */
function importacaoParaResposta(documento, extras = {}) {
    return {
        importacaoId: String(documento._id),
        status: documento.status,
        turmaId: String(documento.turmaId),
        anoLetivo: documento.anoLetivo,
        nomeArquivo: documento.nomeArquivo,
        tipoArquivo: documento.tipoArquivo,
        cabecalho: documento.cabecalho,
        resumo: documento.resumo,
        avisos: documento.avisos,
        linhas: documento.linhas,
        expiraEm: documento.expiraEm,
        ...extras,
    };
}

// POST /api/secretaria/turmas/:turmaId/alunos/importar/preview
exports.previewImportacao = async (req, res) => {
    let arquivo = req.file;
    try {
        const turma = await carregarTurmaDaEscola(req, req.params.turmaId);
        if (!turma) return falhar(res, 404, 'Turma não encontrada.');
        if (!arquivo?.buffer) return falhar(res, 400, 'Envie um arquivo PDF, XLSX ou CSV.');

        const anoLetivo = resolverAnoLetivo(req, turma);

        // Mapeamento manual de colunas, quando a tela precisou pedir ao usuário.
        let mapaColunas;
        if (req.body?.mapaColunas) {
            try {
                const bruto =
                    typeof req.body.mapaColunas === 'string'
                        ? JSON.parse(req.body.mapaColunas)
                        : req.body.mapaColunas;
                mapaColunas = {};
                for (const [campo, indice] of Object.entries(bruto || {})) {
                    const numero = parseInt(indice, 10);
                    if (Number.isFinite(numero) && numero >= 0) mapaColunas[campo] = numero;
                }
            } catch {
                return falhar(res, 400, 'Mapeamento de colunas inválido.');
            }
        }

        const hash = importacao.hashArquivo(arquivo.buffer);
        const tamanho = arquivo.size;

        let lido;
        try {
            lido = await importacao.lerArquivo({ buffer: arquivo.buffer, mapaColunas });
        } catch (erro) {
            if (erro.leitura) return falhar(res, 422, erro.message);
            throw erro;
        }

        // Mapeamento manual necessário: devolve as colunas do arquivo para a
        // tela montar os selects, sem criar sessão de importação.
        if (lido.faltando.length > 0) {
            return res.status(422).json({
                success: false,
                error: lido.avisos[0] || 'Não foi possível identificar as colunas obrigatórias.',
                codigo: 'MAPEAMENTO_NECESSARIO',
                data: { colunas: lido.colunas, faltando: lido.faltando },
            });
        }

        const retrato = await retratoDaEscola(req, turma, anoLetivo, lido.registros);
        const { linhas, resumo } = classificador.classificarLinhas({
            registros: lido.registros,
            ...retrato,
        });

        const conferenciaTotais = classificador.conferirTotais(lido.totalDeclarado, linhas.length);
        const conferenciaTurma = classificador.conferirTurma(lido.cabecalho, turma);

        const avisos = [...lido.avisos];
        if (conferenciaTotais.confere === false) avisos.unshift(conferenciaTotais.mensagem);
        if (conferenciaTurma.confere === false) avisos.unshift(conferenciaTurma.mensagem);

        const agora = Date.now();
        const documento = await ImportacaoAlunos.create({
            escolaId: escolaAtual(req),
            turmaId: String(turma._id),
            anoLetivo,
            usuarioId: usuarioAtual(req),
            nomeArquivo: String(arquivo.originalname || '').slice(0, 200),
            tipoArquivo: lido.tipo,
            hashArquivo: hash,
            tamanhoArquivo: tamanho,
            cabecalho: lido.cabecalho,
            linhas,
            resumo,
            avisos,
            status: 'preview',
            expiraEm: new Date(agora + ImportacaoAlunos.PRAZO_PREVIEW_MS),
        });

        // LGPD: contadores e identificadores. Nunca nome, RA ou nascimento.
        logger.info('[SecretariaTurmaAlunos] pré-visualização de importação gerada', {
            action: 'secretaria.importacao.preview',
            importacaoId: String(documento._id),
            tipoArquivo: lido.tipo,
            totalLinhas: resumo.total,
            novos: resumo.novos,
            comErro: resumo.comErro,
        });

        await audit(req, 'PREVIEW_IMPORT_STUDENTS', 'ImportacaoAlunos', documento._id, {
            descricao: `Pré-visualização de importação (${lido.tipo}, ${resumo.total} linhas) para a turma ${turma.nome || turma._id}`,
        });

        return res.status(201).json({
            success: true,
            data: importacaoParaResposta(documento, {
                conferenciaTotais,
                conferenciaTurma,
                totalDeclarado: lido.totalDeclarado,
                turma: { id: String(turma._id), nome: turma.nome || turma.id || '' },
            }),
        });
    } catch (error) {
        logger.error('[SecretariaTurmaAlunos.preview] falha ao processar arquivo', {
            err: error,
            action: 'secretaria.importacao.preview',
        });
        return falhar(res, 500, 'Não foi possível processar o arquivo. Tente novamente.');
    } finally {
        // Libera o buffer imediatamente: o Render tem memória curta e este
        // buffer carrega dado pessoal que não deve sobreviver ao request.
        if (arquivo) {
            arquivo.buffer = null;
            arquivo = null;
        }
        if (req.file) req.file.buffer = null;
    }
};

/** Carrega uma sessão de importação garantindo escola + turma. */
async function carregarImportacao(req, turma, status) {
    const filtro = escopo(req, {
        _id: String(req.params.importacaoId),
        turmaId: String(turma._id),
    });
    if (status) filtro.status = status;
    return ImportacaoAlunos.findOne(filtro);
}

// POST /api/secretaria/turmas/:turmaId/alunos/importar/:importacaoId/cancelar
exports.cancelarImportacao = async (req, res) => {
    try {
        const turma = await carregarTurmaDaEscola(req, req.params.turmaId);
        if (!turma) return falhar(res, 404, 'Turma não encontrada.');

        const documento = await carregarImportacao(req, turma, 'preview');
        if (!documento) return falhar(res, 404, 'Importação não encontrada ou já finalizada.');

        documento.status = 'cancelada';
        documento.linhas = []; // minimização de dado: cancelou, não precisa mais
        await documento.save();

        await audit(req, 'CANCEL_IMPORT_STUDENTS', 'ImportacaoAlunos', documento._id, {
            descricao: 'Importação cancelada antes da gravação',
        });

        return res.json({
            success: true,
            data: { importacaoId: String(documento._id), status: 'cancelada' },
        });
    } catch (error) {
        logger.error('[SecretariaTurmaAlunos.cancelar] falha ao cancelar importação', {
            err: error,
            action: 'secretaria.importacao.cancelar',
        });
        return falhar(res, 500, 'Não foi possível cancelar a importação.');
    }
};

/** Divide uma lista em blocos de tamanho fixo. */
function emLotes(lista, tamanho) {
    const lotes = [];
    for (let i = 0; i < lista.length; i += tamanho) lotes.push(lista.slice(i, i + tamanho));
    return lotes;
}

// POST /api/secretaria/turmas/:turmaId/alunos/importar/:importacaoId/confirmar
exports.confirmarImportacao = async (req, res) => {
    try {
        const turma = await carregarTurmaDaEscola(req, req.params.turmaId);
        if (!turma) return falhar(res, 404, 'Turma não encontrada.');

        const documento = await carregarImportacao(req, turma, 'preview');
        if (!documento)
            return falhar(res, 404, 'Importação não encontrada, já confirmada ou expirada.');
        if (documento.expiraEm && documento.expiraEm.getTime() < Date.now()) {
            return falhar(res, 410, 'Esta pré-visualização expirou. Envie o arquivo novamente.');
        }

        const anoLetivo = documento.anoLetivo;
        const importacaoId = String(documento._id);

        // Índices escolhidos pelo usuário. Sem a lista, entram os importáveis.
        const selecionados = Array.isArray(req.body?.indices)
            ? new Set(req.body.indices.map((n) => parseInt(n, 10)).filter(Number.isFinite))
            : null;
        // Índices cujo cadastro o usuário autorizou ATUALIZAR (linhas divergentes).
        const autorizadosAtualizar = new Set(
            (Array.isArray(req.body?.atualizarCadastro) ? req.body.atualizarCadastro : [])
                .map((n) => parseInt(n, 10))
                .filter(Number.isFinite)
        );

        // RECONFERÊNCIA NO SERVIDOR. O cliente manda índices, não status: nada
        // do que ele afirma sobre a linha é aceito. Se o banco mudou entre o
        // preview e o confirmar (outra secretaria importou a mesma classe), a
        // reclassificação abaixo é o que impede a duplicata.
        const registros = documento.linhas.map((linha) => linha.dadosBrutos);
        const retrato = await retratoDaEscola(req, turma, anoLetivo, registros);
        const { linhas: reclassificadas } = classificador.classificarLinhas({
            registros,
            ...retrato,
        });

        const aGravar = reclassificadas.filter((linha) => {
            if (!STATUS_IMPORTAVEIS.has(linha.status)) return false;
            return selecionados ? selecionados.has(linha.indice) : true;
        });

        const falhas = [];
        let criados = 0;
        let vinculados = 0;
        let atualizados = 0;
        let transferidos = 0;

        // ── 1. Alunos: upsert idempotente por {escolaId, ra} ────────────────
        // `updateOne` com upsert filtrando pela CHAVE ÚNICA torna o duplo
        // clique inofensivo: a segunda passada encontra o documento e não cria
        // nada. `ordered: false` mantém o lote andando quando uma linha falha.
        const operacoesAluno = aGravar.map((linha) => {
            const dados = linha.dadosNormalizados;
            const atualizarCadastro =
                linha.status === STATUS.DIVERGENTE && autorizadosAtualizar.has(linha.indice);

            const sempre = {
                raDigito: dados.raDigito,
                raUf: dados.raUf,
                situacao: dados.situacao,
                dataMovimentacao: dados.dataMovimentacao,
                pcd: dados.possuiDeficiencia,
                turma: turma.nome || turma.id,
                turmaId: String(turma._id),
                ativo: true,
                ...(dados.transtornos.length ? { transtornos: dados.transtornos } : {}),
            };

            // Nome e nascimento só são sobrescritos com autorização explícita —
            // o arquivo não manda no cadastro que já existe.
            const identidade = {
                nome: dados.nome,
                nomeNormalizado: dados.nomeNormalizado,
                nascimento: dados.dataNascimento,
            };

            return {
                updateOne: {
                    filter: escopo(req, { matricula: dados.ra }),
                    update: {
                        $set: atualizarCadastro ? { ...sempre, ...identidade } : sempre,
                        $setOnInsert: {
                            ...identidade,
                            matricula: dados.ra,
                            escolaId: escolaAtual(req),
                            origemCadastro:
                                documento.tipoArquivo === 'pdf'
                                    ? 'importacao_pdf'
                                    : 'importacao_planilha',
                            importacaoId,
                        },
                    },
                    upsert: true,
                },
            };
        });

        for (const lote of emLotes(operacoesAluno, TAMANHO_LOTE)) {
            try {
                const resultado = await Aluno.bulkWrite(lote, { ordered: false });
                criados += resultado.upsertedCount || 0;
                atualizados += resultado.modifiedCount || 0;
            } catch (erro) {
                // Com ordered:false as demais operações valem; registra o
                // ÍNDICE do erro, nunca o conteúdo da linha.
                registrarFalhasDoLote(erro, lote, aGravar, falhas);
            }
        }

        // ── 2. Código secreto para os alunos recém-criados ──────────────────
        // O `pre('save')` não roda em bulkWrite, e sem codigoSecreto o
        // responsável não consegue se vincular ao filho — o aluno entraria no
        // sistema inutilizável.
        const ras = aGravar.map((linha) => linha.dadosNormalizados.ra);
        const gravados = await Aluno.find(escopo(req, { matricula: { $in: ras } }))
            .select('_id matricula codigoSecreto')
            .lean();
        const idPorRa = new Map(
            gravados.map((aluno) => [String(aluno.matricula), String(aluno._id)])
        );
        const semCodigo = gravados
            .filter((aluno) => !aluno.codigoSecreto)
            .map((aluno) => aluno._id);
        if (semCodigo.length > 0) await assignSecretCodes(semCodigo);

        // ── 3. Matrículas ───────────────────────────────────────────────────
        const numeroBase = await proximoNumeroChamada(req, turma._id, anoLetivo);
        let proximoLivre = numeroBase;
        // Sem `Nr` no arquivo, numera por ordem alfabética (§5.7).
        const semNumero = aGravar
            .filter((linha) => !linha.dadosNormalizados.numeroChamada)
            .sort((a, b) =>
                a.dadosNormalizados.nomeNormalizado.localeCompare(
                    b.dadosNormalizados.nomeNormalizado,
                    'pt-BR'
                )
            );
        const numeroAtribuido = new Map(semNumero.map((linha) => [linha.indice, proximoLivre++]));

        const operacoesMatricula = [];
        for (const linha of aGravar) {
            const alunoId = idPorRa.get(linha.dadosNormalizados.ra);
            if (!alunoId) {
                falhas.push({
                    linha: linha.indice,
                    motivo: 'Aluno não foi gravado; matrícula não criada.',
                });
                continue;
            }
            if (linha.transferenciaDe) transferidos++;

            operacoesMatricula.push({
                updateOne: {
                    filter: escopo(req, { alunoId, anoLetivo }),
                    update: {
                        $set: {
                            turmaId: String(turma._id),
                            numeroChamada:
                                linha.dadosNormalizados.numeroChamada ||
                                numeroAtribuido.get(linha.indice) ||
                                null,
                            serie: linha.dadosNormalizados.serie || '',
                            status: 'cursando',
                        },
                        $setOnInsert: {
                            alunoId,
                            anoLetivo,
                            escolaId: escolaAtual(req),
                            criadoPor: usuarioAtual(req),
                            importacaoId,
                        },
                    },
                    upsert: true,
                },
            });
        }

        for (const lote of emLotes(operacoesMatricula, TAMANHO_LOTE)) {
            try {
                const resultado = await Matricula.bulkWrite(lote, { ordered: false });
                vinculados += resultado.upsertedCount || 0;
            } catch (erro) {
                registrarFalhasDoLote(erro, lote, aGravar, falhas);
            }
        }

        // ── 4. Fecha a sessão ───────────────────────────────────────────────
        const ignorados = reclassificadas.length - aGravar.length;
        const resultado = { criados, vinculados, atualizados, transferidos, ignorados, falhas };

        documento.status = 'confirmada';
        documento.confirmadoEm = new Date();
        documento.resultado = resultado;
        documento.resumo = classificador.resumir(reclassificadas);
        // Empurra a expiração para a janela do "Desfazer": sem isso o TTL de 2 h
        // apagaria a sessão e o botão desfazer deixaria de existir.
        documento.expiraEm = new Date(Date.now() + ImportacaoAlunos.PRAZO_DESFAZER_MS);
        await documento.save();

        logger.info('[SecretariaTurmaAlunos] importação confirmada', {
            action: 'secretaria.importacao.confirmar',
            importacaoId,
            criados,
            vinculados,
            atualizados,
            transferidos,
            falhas: falhas.length,
        });

        await audit(req, 'IMPORT_STUDENTS', 'ImportacaoAlunos', importacaoId, {
            descricao: `Importação confirmada na turma ${turma.nome || turma._id}: ${criados} criados, ${vinculados} vinculados, ${atualizados} atualizados, ${falhas.length} falhas (arquivo ${documento.nomeArquivo}, sha256 ${documento.hashArquivo})`,
        });
        emitirParaEscola(escolaAtual(req), 'turma:alunos_alterados', {
            turmaId: String(turma._id),
            anoLetivo,
        });

        return res.json({
            success: true,
            data: {
                importacaoId,
                podeDesfazerAte: documento.expiraEm,
                ...resultado,
            },
        });
    } catch (error) {
        logger.error('[SecretariaTurmaAlunos.confirmar] falha ao gravar importação', {
            err: error,
            action: 'secretaria.importacao.confirmar',
        });
        return falhar(res, 500, 'Não foi possível concluir a importação.');
    }
};

/**
 * Traduz o erro de um bulkWrite parcial em falhas por linha.
 * Registra o ÍNDICE e o código do erro — nunca o documento que falhou, que
 * carrega nome e RA.
 */
function registrarFalhasDoLote(erro, lote, linhas, falhas) {
    const resultados = erro.writeErrors || erro.result?.getWriteErrors?.() || [];
    if (resultados.length === 0) {
        falhas.push({
            linha: null,
            motivo: `Falha ao gravar um bloco de ${lote.length} registros.`,
        });
        return;
    }
    for (const falha of resultados) {
        const posicao = typeof falha.index === 'number' ? falha.index : null;
        const linha = posicao !== null && linhas[posicao] ? linhas[posicao].indice : null;
        falhas.push({
            linha,
            motivo:
                falha.code === 11000
                    ? 'Registro duplicado (RA já existente).'
                    : 'Falha ao gravar o registro.',
        });
    }
}

// POST /api/secretaria/turmas/:turmaId/alunos/importar/:importacaoId/desfazer
// Remove APENAS o que aquele lote criou. Aluno que já existia antes nunca é
// apagado — por isso a exclusão exige as três condições juntas: veio de
// importação, veio DESTE lote, e não tem nenhuma outra matrícula.
exports.desfazerImportacao = async (req, res) => {
    try {
        const turma = await carregarTurmaDaEscola(req, req.params.turmaId);
        if (!turma) return falhar(res, 404, 'Turma não encontrada.');

        const documento = await carregarImportacao(req, turma, 'confirmada');
        if (!documento)
            return falhar(res, 404, 'Importação não encontrada ou não pode mais ser desfeita.');

        const importacaoId = String(documento._id);
        const limite = documento.confirmadoEm
            ? documento.confirmadoEm.getTime() + ImportacaoAlunos.PRAZO_DESFAZER_MS
            : 0;
        if (Date.now() > limite) {
            return falhar(res, 410, 'O prazo de 24 horas para desfazer esta importação já passou.');
        }

        // 1. Matrículas criadas por este lote.
        const matriculas = await Matricula.find(escopo(req, { importacaoId }))
            .select('_id alunoId')
            .lean();
        const alunoIds = [...new Set(matriculas.map((m) => String(m.alunoId)))];
        const matriculasRemovidas = await Matricula.deleteMany(escopo(req, { importacaoId }));

        // 2. Alunos CRIADOS por este lote — e só eles.
        const candidatos = await Aluno.find(
            escopo(req, {
                importacaoId,
                origemCadastro: { $in: ['importacao_pdf', 'importacao_planilha'] },
            })
        )
            .select('_id')
            .lean();

        const idsCandidatos = candidatos.map((a) => String(a._id));
        let alunosRemovidos = 0;

        if (idsCandidatos.length > 0) {
            // 3. Quem ficou com matrícula em OUTRA turma/ano é preservado: o
            //    lote criou o cadastro, mas alguém já o usou para outra coisa.
            const aindaMatriculados = await Matricula.find(
                escopo(req, { alunoId: { $in: idsCandidatos } })
            )
                .select('alunoId')
                .lean();
            const preservar = new Set(aindaMatriculados.map((m) => String(m.alunoId)));
            const removiveis = idsCandidatos.filter((id) => !preservar.has(id));

            if (removiveis.length > 0) {
                const resultado = await Aluno.deleteMany(
                    escopo(req, {
                        _id: { $in: removiveis },
                        importacaoId,
                        origemCadastro: { $in: ['importacao_pdf', 'importacao_planilha'] },
                    })
                );
                alunosRemovidos = resultado.deletedCount || 0;
            }
        }

        // 4. Limpa o cache legado dos alunos que perderam o vínculo.
        if (alunoIds.length > 0) {
            await Aluno.updateMany(
                escopo(req, { _id: { $in: alunoIds }, turmaId: String(turma._id) }),
                { $set: { turma: '', turmaId: '' } }
            );
        }

        documento.status = 'desfeita';
        documento.desfeitoEm = new Date();
        documento.desfeitoPor = usuarioAtual(req);
        documento.linhas = []; // minimização de dado
        await documento.save();

        logger.info('[SecretariaTurmaAlunos] importação desfeita', {
            action: 'secretaria.importacao.desfazer',
            importacaoId,
            matriculasRemovidas: matriculasRemovidas.deletedCount || 0,
            alunosRemovidos,
        });

        await audit(req, 'UNDO_IMPORT_STUDENTS', 'ImportacaoAlunos', importacaoId, {
            descricao: `Importação desfeita: ${matriculasRemovidas.deletedCount || 0} matrículas e ${alunosRemovidos} alunos removidos`,
        });
        emitirParaEscola(escolaAtual(req), 'turma:alunos_alterados', {
            turmaId: String(turma._id),
            anoLetivo: documento.anoLetivo,
        });

        return res.json({
            success: true,
            data: {
                importacaoId,
                matriculasRemovidas: matriculasRemovidas.deletedCount || 0,
                alunosRemovidos,
                alunosPreservados: idsCandidatos.length - alunosRemovidos,
            },
        });
    } catch (error) {
        logger.error('[SecretariaTurmaAlunos.desfazer] falha ao desfazer importação', {
            err: error,
            action: 'secretaria.importacao.desfazer',
        });
        return falhar(res, 500, 'Não foi possível desfazer a importação.');
    }
};

// GET /api/secretaria/turmas/:turmaId/alunos/importar/historico
// Lotes ainda desfazíveis, para a tela reoferecer o botão após um F5.
exports.historicoImportacoes = async (req, res) => {
    try {
        const turma = await carregarTurmaDaEscola(req, req.params.turmaId);
        if (!turma) return falhar(res, 404, 'Turma não encontrada.');

        const lotes = await ImportacaoAlunos.find(
            escopo(req, {
                turmaId: String(turma._id),
                status: 'confirmada',
            })
        )
            .select('nomeArquivo tipoArquivo resultado confirmadoEm anoLetivo')
            .sort({ confirmadoEm: -1 })
            .limit(10)
            .lean();

        const agora = Date.now();
        return res.json({
            success: true,
            data: {
                lotes: lotes.map((lote) => ({
                    importacaoId: String(lote._id),
                    nomeArquivo: lote.nomeArquivo,
                    tipoArquivo: lote.tipoArquivo,
                    confirmadoEm: lote.confirmadoEm,
                    anoLetivo: lote.anoLetivo,
                    resultado: lote.resultado,
                    podeDesfazer:
                        !!lote.confirmadoEm &&
                        agora - lote.confirmadoEm.getTime() < ImportacaoAlunos.PRAZO_DESFAZER_MS,
                })),
            },
        });
    } catch (error) {
        logger.error('[SecretariaTurmaAlunos.historico] falha ao listar importações', {
            err: error,
            action: 'secretaria.importacao.historico',
        });
        return falhar(res, 500, 'Não foi possível carregar o histórico de importações.');
    }
};
