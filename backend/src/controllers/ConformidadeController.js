/**
 * ConformidadeController.js — as rotas de dever legal da escola.
 *
 * O QUE ESTÁ REUNIDO AQUI
 * -----------------------
 * Três obrigações que a rede pública responde com documento, não com tela:
 *
 *   • frequência e comunicação de infrequência (LDB, art. 12, VIII e 24, VI;
 *     ECA, art. 56, II);
 *   • declaração anual ao Censo Escolar (INEP/Educacenso); e
 *   • publicação de indicadores no Portal da Transparência (LAI), sem expor
 *     dado pessoal de criança (LGPD, art. 14).
 *
 * Elas moram no mesmo controller porque compartilham a mesma exigência de
 * rastro: toda exportação daqui grava AuditLog. Não é zelo — é o art. 15 do
 * Marco Civil e o princípio da responsabilização da LGPD: quem levou dado de
 * aluno para fora do sistema, quando e de qual escola precisa ficar registrado.
 * Consulta em tela não gera log; EXPORTAÇÃO gera, sempre.
 *
 * POR QUE O PROFESSOR ENTRA, MAS SÓ ATÉ AS TURMAS DELE
 * ---------------------------------------------------
 * A matriz de acesso do sistema (`utils/matrizAcesso.js`) diz que professor vê
 * apenas os alunos que leciona. Frequência é dado pedagógico que ele precisa
 * ver — mas de "suas turmas" para "a rede inteira" há uma distância que a LGPD
 * chama de finalidade. `req.allowedTurmas` (middleware `horizontalFilter`) é o
 * que fecha essa porta, e por isso o filtro é aplicado ANTES da consulta, e não
 * como um `filter` no resultado: o dado das outras turmas nunca é carregado.
 */

const Escola = require('../models/Escola');
const Usuario = require('../models/Usuario');
const Aluno = require('../models/Aluno');
const logger = require('../utils/logger');
const { logAction } = require('../utils/auditHelper');
const { escolaMatch } = require('../middleware/filtrarPorEscola');
const { obterPrinter } = require('./RelatorioController');
const { avaliarTurmas, avaliarAluno } = require('../services/conformidade/monitorEvasao');
const { montarFicha } = require('../services/conformidade/fichaConselhoTutelar');
const { montarLote } = require('../services/conformidade/educacenso');
const { gerarArquivo } = require('../services/conformidade/leiauteEducacenso');
const { situacaoAtual } = require('../utils/soberaniaDados');
const { montarPainel } = require('../services/conformidade/dadosAbertos');
const {
    podeAnonimizar,
    planoDeAnonimizacao,
    CAMPOS_PRESERVADOS,
} = require('../services/conformidade/anonimizacaoAluno');
const { DIAS_LETIVOS_PADRAO } = require('../services/conformidade/frequenciaLdb');
const {
    VALIDADE_MS,
    METODOS,
    gerarCodigo,
    situacaoDoCodigo,
    registroDeConsentimento,
    emailDoCodigo,
} = require('../services/conformidade/validacaoConsentimento');
const { hashSegredo, conferirSegredo } = require('../utils/codigosBackup');
const { enviarEmail } = require('../services/EnvioEmail');
const { CONSENTIMENTO_ID, CONSENTIMENTO_VERSAO } = require('../utils/consentimentoLgpd');

/** Dias letivos previstos: query > padrão da LDB. Sempre inteiro positivo. */
function diasLetivosDaRequisicao(req) {
    const informado = Number.parseInt(req.query.diasLetivos, 10);
    return Number.isFinite(informado) && informado > 0 ? informado : DIAS_LETIVOS_PADRAO;
}

function anoLetivoDaRequisicao(req) {
    const informado = Number.parseInt(req.query.anoLetivo, 10);
    return Number.isFinite(informado) ? informado : new Date().getFullYear();
}

/** Professor só enxerga as turmas atribuídas a ele; os demais, a escola toda. */
function turmasVisiveis(req) {
    return req.user?.perfil === 'professor' ? req.allowedTurmas || [] : undefined;
}

// GET /api/conformidade/frequencia/alertas
exports.alertasEvasao = async (req, res) => {
    try {
        const turmas = turmasVisiveis(req);
        // Professor sem turma atribuída não é "professor de todas": é professor
        // de nenhuma. Devolver a escola inteira aqui seria o vazamento clássico
        // de lista vazia interpretada como "sem filtro".
        if (Array.isArray(turmas) && turmas.length === 0) {
            return res.json({ success: true, data: [], total: 0 });
        }

        const dados = await avaliarTurmas({
            filtroEscola: escolaMatch(req.escolaId),
            anoLetivo: anoLetivoDaRequisicao(req),
            turmas,
            diasLetivosPrevistos: diasLetivosDaRequisicao(req),
            somenteAlertas: req.query.somenteAlertas !== 'false',
        });

        res.json({ success: true, data: dados, total: dados.length });
    } catch (error) {
        logger.error(`[Conformidade.alertasEvasao] ${error.message}`);
        res.status(500).json({ success: false, error: 'Falha ao apurar a frequência.' });
    }
};

// GET /api/conformidade/frequencia/:alunoId
exports.frequenciaDoAluno = async (req, res) => {
    try {
        const avaliacao = await avaliarAluno({
            alunoId: req.params.alunoId,
            filtroEscola: escolaMatch(req.escolaId),
            anoLetivo: anoLetivoDaRequisicao(req),
            diasLetivosPrevistos: diasLetivosDaRequisicao(req),
        });
        if (!avaliacao) {
            return res.status(404).json({ success: false, error: 'Aluno não encontrado.' });
        }

        const turmas = turmasVisiveis(req);
        if (Array.isArray(turmas) && !turmas.includes(avaliacao.turma)) {
            return res.status(403).json({
                success: false,
                error: 'Acesso negado: este aluno não pertence às suas turmas.',
            });
        }

        res.json({ success: true, data: avaliacao });
    } catch (error) {
        logger.error(`[Conformidade.frequenciaDoAluno] ${error.message}`);
        res.status(500).json({ success: false, error: 'Falha ao apurar a frequência.' });
    }
};

// GET /api/conformidade/frequencia/:alunoId/ficha-conselho
exports.fichaConselhoTutelar = async (req, res) => {
    try {
        const filtroEscola = escolaMatch(req.escolaId);
        const avaliacao = await avaliarAluno({
            alunoId: req.params.alunoId,
            filtroEscola,
            anoLetivo: anoLetivoDaRequisicao(req),
            diasLetivosPrevistos: diasLetivosDaRequisicao(req),
        });
        if (!avaliacao) {
            return res.status(404).json({ success: false, error: 'Aluno não encontrado.' });
        }

        const printer = obterPrinter();
        if (!printer) {
            return res
                .status(503)
                .json({ success: false, error: 'Gerador de PDF indisponível no servidor.' });
        }

        const [aluno, escola] = await Promise.all([
            Aluno.findOne({ ...filtroEscola, _id: String(req.params.alunoId) }).lean(),
            req.escolaId ? Escola.findById(req.escolaId).lean() : null,
        ]);

        const doc = printer.createPdfKitDocument(
            montarFicha({
                aluno,
                escola: escola || {},
                avaliacao,
                emitente: { nome: req.user?.nome, perfil: req.user?.perfil },
            })
        );

        // A ficha é documento oficial que sai com nome, endereço e telefone de
        // responsável. O log é gravado ANTES de mandar os bytes: falha no meio
        // do stream não pode resultar em documento entregue sem rastro.
        await logAction(req, 'EXPORTAR_FICHA_CONSELHO_TUTELAR', 'Conformidade', {
            recursoId: String(req.params.alunoId),
            descricao:
                `Ficha de comunicação de aluno infrequente emitida — ` +
                `${avaliacao.faltas} dia(s) de falta, situação ${avaliacao.status}.`,
        });

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader(
            'Content-Disposition',
            `attachment; filename=ficha-conselho-tutelar-${String(req.params.alunoId)}.pdf`
        );
        doc.pipe(res);
        doc.end();
    } catch (error) {
        logger.error(`[Conformidade.fichaConselhoTutelar] ${error.message}`);
        if (!res.headersSent) {
            res.status(500).json({ success: false, error: 'Falha ao gerar a ficha.' });
        }
    }
};

// GET /api/conformidade/educacenso
exports.exportarEducacenso = async (req, res) => {
    try {
        const filtroEscola = escolaMatch(req.escolaId);
        if (!req.escolaId) {
            // O Censo é declarado POR UNIDADE. Sem escola resolvida, o lote sairia
            // misturando matrículas de escolas diferentes sob um único código INEP.
            return res.status(400).json({
                success: false,
                error: 'Selecione a escola antes de exportar o Censo Escolar.',
            });
        }

        const [escola, alunos] = await Promise.all([
            Escola.findById(req.escolaId).lean(),
            Aluno.find({ ...filtroEscola, ativo: true })
                .select(
                    'nome sobrenome matricula codigoInep cpfAluno nascimento sexo etnia ' +
                        'nacionalidade turma pcd deficiencia transtornos situacao'
                )
                .lean(),
        ]);

        const lote = montarLote({
            escola: escola || {},
            alunos,
            anoCenso: Number.parseInt(req.query.anoCenso, 10) || undefined,
            geradoPor: req.user?.nome || null,
        });

        await logAction(req, 'EXPORTAR_EDUCACENSO', 'Conformidade', {
            recursoId: String(req.escolaId),
            descricao:
                `Lote do Censo Escolar ${lote.cabecalho.anoCenso} gerado com ` +
                `${lote.resumo.totalAlunos} matrícula(s) e ${lote.resumo.alunosComPendencia} pendência(s).`,
        });

        // Arquivo de migração do INEP (`|`-delimitado). Recusa lote com
        // pendência: arquivo com aluno incompleto é declaração errada, e este é
        // o último momento em que ainda dá tempo de corrigir o cadastro.
        if (req.query.formato === 'txt') {
            try {
                const arquivo = gerarArquivo(lote, {
                    permitirPendencias: req.query.permitirPendencias === 'true',
                });
                res.setHeader('Content-Type', 'text/plain; charset=utf-8');
                res.setHeader(
                    'Content-Disposition',
                    `attachment; filename=educacenso-${lote.cabecalho.anoCenso}.txt`
                );
                return res.send(arquivo.conteudo);
            } catch (erro) {
                if (erro.codigo !== 'EDUCACENSO_LOTE_INCOMPLETO') throw erro;
                return res.status(409).json({
                    success: false,
                    error: erro.message,
                    pendenciasEscola: erro.pendenciasEscola,
                    pendencias: erro.pendencias,
                });
            }
        }

        if (req.query.formato === 'arquivo') {
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            res.setHeader(
                'Content-Disposition',
                `attachment; filename=educacenso-${lote.cabecalho.anoCenso}.json`
            );
            return res.send(JSON.stringify(lote, null, 4));
        }

        res.json({ success: true, data: lote });
    } catch (error) {
        logger.error(`[Conformidade.exportarEducacenso] ${error.message}`);
        res.status(500).json({ success: false, error: 'Falha ao gerar o lote do Censo.' });
    }
};

// GET /api/conformidade/dados-abertos
exports.dadosAbertos = async (req, res) => {
    try {
        const painel = await montarPainel({
            filtroEscola: escolaMatch(req.escolaId),
            anoLetivo: anoLetivoDaRequisicao(req),
            diasLetivosPrevistos: diasLetivosDaRequisicao(req),
        });

        await logAction(req, 'EXPORTAR_DADOS_ABERTOS', 'Conformidade', {
            recursoId: req.escolaId ? String(req.escolaId) : 'rede',
            descricao: `Painel de dados abertos (LAI) gerado para ${painel.metadados.anoLetivo}.`,
        });

        res.json({ success: true, data: painel });
    } catch (error) {
        logger.error(`[Conformidade.dadosAbertos] ${error.message}`);
        res.status(500).json({
            success: false,
            error: 'Falha ao montar o painel de dados abertos.',
        });
    }
};

// POST /api/conformidade/alunos/:alunoId/anonimizar
exports.anonimizarAluno = async (req, res) => {
    try {
        // Confirmação explícita, e não um `?confirmar=1` na URL: a operação é
        // IRREVERSÍVEL e não pode acontecer por um link clicado sem querer ou
        // por um GET repetido pelo navegador.
        if (req.body?.confirmar !== true) {
            return res.status(400).json({
                success: false,
                error:
                    'A anonimização é irreversível. Envie { "confirmar": true } para prosseguir, ' +
                    'e só depois de emitir e arquivar o histórico escolar do aluno.',
            });
        }

        const filtroEscola = escolaMatch(req.escolaId);
        const aluno = await Aluno.findOne({
            ...filtroEscola,
            _id: String(req.params.alunoId),
        }).lean();

        const permissao = podeAnonimizar(aluno);
        if (!permissao.permitido) {
            return res.status(aluno ? 409 : 404).json({ success: false, error: permissao.motivo });
        }

        const plano = planoDeAnonimizacao(aluno, { executadoPor: req.user?.nome || null });
        await Aluno.updateOne({ _id: aluno._id }, { $set: plano.$set, $unset: plano.$unset });

        // O log registra QUAIS campos saíram, jamais o QUE havia neles. Gravar
        // `valorAnterior` aqui guardaria nome, CPF e endereço da criança num
        // documento imutável e com retenção de um ano — a anonimização teria
        // apenas mudado o dado de lugar.
        await logAction(req, 'ANONIMIZAR_ALUNO', 'Conformidade', {
            recursoId: String(aluno._id),
            descricao:
                `Cadastro anonimizado (LGPD, art. 18, VI) — ${plano.camposRemovidos.length} ` +
                `campo(s) identificador(es) removido(s); vida escolar preservada. ` +
                `Situação registrada: ${aluno.situacao || 'não informada'}.`,
        });

        res.json({
            success: true,
            data: {
                alunoId: String(aluno._id),
                pseudonimo: plano.pseudonimo,
                camposRemovidos: plano.camposRemovidos,
                camposPreservados: CAMPOS_PRESERVADOS,
            },
        });
    } catch (error) {
        logger.error(`[Conformidade.anonimizarAluno] ${error.message}`);
        res.status(500).json({ success: false, error: 'Falha ao anonimizar o cadastro.' });
    }
};

// POST /api/conformidade/consentimento/codigo
exports.solicitarCodigoConsentimento = async (req, res) => {
    try {
        const usuarioId = req.user?.id || req.user?._id;
        const usuario = await Usuario.findById(usuarioId).select('nome email').lean();
        if (!usuario?.email) {
            return res.status(400).json({
                success: false,
                error: 'Não há e-mail cadastrado nesta conta para enviar o código.',
            });
        }

        const codigo = gerarCodigo();
        await Usuario.updateOne(
            { _id: usuarioId },
            {
                $set: {
                    consentimentoPendingToken: await hashSegredo(codigo),
                    consentimentoPendingExpiry: new Date(Date.now() + VALIDADE_MS),
                    consentimentoPendingTentativas: 0,
                },
            }
        );

        const { assunto, html } = emailDoCodigo(codigo, usuario.nome);
        await enviarEmail(usuario.email, assunto, html);

        // A resposta NÃO devolve o código nem o e-mail completo. Devolver o
        // e-mail inteiro aqui entregaria o endereço do responsável a quem
        // estivesse com a sessão aberta no aparelho dele.
        res.json({
            success: true,
            data: { enviado: true, validadeMinutos: Math.round(VALIDADE_MS / 60000) },
        });
    } catch (error) {
        logger.error(`[Conformidade.solicitarCodigoConsentimento] ${error.message}`);
        res.status(500).json({ success: false, error: 'Falha ao enviar o código.' });
    }
};

// POST /api/conformidade/consentimento/confirmar
exports.confirmarConsentimento = async (req, res) => {
    try {
        const usuarioId = req.user?.id || req.user?._id;
        const usuario = await Usuario.findById(usuarioId)
            .select(
                '+consentimentoPendingToken +consentimentoPendingExpiry ' +
                    '+consentimentoPendingTentativas'
            )
            .lean();

        const situacao = situacaoDoCodigo(
            {
                expiraEm: usuario?.consentimentoPendingExpiry,
                tentativas: usuario?.consentimentoPendingTentativas,
            },
            new Date()
        );
        if (!situacao.valido) {
            return res.status(400).json({ success: false, error: situacao.motivo });
        }

        const confere = await conferirSegredo(
            String(req.body?.codigo || ''),
            usuario.consentimentoPendingToken
        );
        if (!confere) {
            // Conta a tentativa ANTES de responder: sem isso, o limite de
            // tentativas é decorativo e os 10^6 códigos caem por força bruta.
            await Usuario.updateOne(
                { _id: usuarioId },
                { $inc: { consentimentoPendingTentativas: 1 } }
            );
            return res.status(401).json({ success: false, error: 'Código inválido.' });
        }

        const registro = registroDeConsentimento({
            termoId: CONSENTIMENTO_ID,
            versao: CONSENTIMENTO_VERSAO,
            metodoValidacao: METODOS.EMAIL,
            req,
        });

        await Usuario.updateOne(
            { _id: usuarioId },
            {
                $push: { lgpdHistory: registro },
                $set: {
                    // Mesma dupla escrita do aceite do Termo: o campo é o que o
                    // portal e o `/api/auth/me` leem; o histórico é a prova.
                    consentimentoAceiteEm: registro.aceitoEm,
                    consentimentoVersao: CONSENTIMENTO_VERSAO,
                },
                $unset: {
                    consentimentoPendingToken: '',
                    consentimentoPendingExpiry: '',
                    consentimentoPendingTentativas: '',
                },
            }
        );

        await logAction(req, 'LGPD_CONSENTIMENTO_VALIDADO', 'Usuarios', {
            recursoId: String(usuarioId),
            descricao:
                `Consentimento ${CONSENTIMENTO_VERSAO} confirmado com validação ` +
                `${METODOS.EMAIL} (LGPD, art. 14, §1º).`,
        });

        res.json({
            success: true,
            data: {
                termoId: registro.termoId,
                versao: registro.versao,
                aceitoEm: registro.aceitoEm,
                metodoValidacao: registro.metodoValidacao,
            },
        });
    } catch (error) {
        logger.error(`[Conformidade.confirmarConsentimento] ${error.message}`);
        res.status(500).json({ success: false, error: 'Falha ao confirmar o consentimento.' });
    }
};

// GET /api/conformidade/soberania
exports.soberaniaDeDados = async (_req, res) => {
    // Sem dado de aluno na resposta: é diagnóstico de infraestrutura, e existe
    // para que a rede consiga responder "onde ficam os dados?" com data e por
    // escrito, em vez de depender da memória de quem criou o cluster.
    res.json({ success: true, data: situacaoAtual() });
};
