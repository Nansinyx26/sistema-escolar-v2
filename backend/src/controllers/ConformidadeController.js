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
const Aluno = require('../models/Aluno');
const logger = require('../utils/logger');
const { logAction } = require('../utils/auditHelper');
const { escolaMatch } = require('../middleware/filtrarPorEscola');
const { obterPrinter } = require('./RelatorioController');
const { avaliarTurmas, avaliarAluno } = require('../services/conformidade/monitorEvasao');
const { montarFicha } = require('../services/conformidade/fichaConselhoTutelar');
const { montarLote } = require('../services/conformidade/educacenso');
const { montarPainel } = require('../services/conformidade/dadosAbertos');
const { DIAS_LETIVOS_PADRAO } = require('../services/conformidade/frequenciaLdb');

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
