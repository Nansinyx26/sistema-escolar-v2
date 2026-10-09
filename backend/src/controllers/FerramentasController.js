/**
 * FerramentasController — autorização de ferramentas por professor (Issue #720).
 *
 * A direção vê e decide só na PRÓPRIA escola: a escola é a da sessão
 * (`req.escolaId`, conferida contra os vínculos por `filtrarPorEscola`). O
 * professor nunca grava a própria autorização — as rotas de decisão exigem
 * diretor (ou admin com escola escolhida), e o id do professor que chega no
 * corpo é conferido contra os professores da escola antes de qualquer escrita.
 *
 * Toda mudança vai ao AuditLog com quem decidiu, professor, ferramenta, antes
 * e depois.
 */
const obs = require('../observability');
const logger = require('../utils/logger');
const { logAction } = require('../utils/auditHelper');
const { catalogoPorCategoria } = require('../services/ferramentas/catalogo');
const {
    quadroDaEscola,
    situacaoDoUsuario,
    salvarAutorizacoes,
    solicitarFerramenta,
    listarSolicitacoes,
    decidirSolicitacao,
} = require('../services/ferramentas/permissaoFerramenta');

function semEscola(res) {
    return res.status(400).json({
        success: false,
        codigo: 'ESCOLA_NAO_INFORMADA',
        error: 'Selecione a escola antes de gerenciar as autorizações de ferramentas.',
    });
}

function falha(res, rotulo, error) {
    if (error.status && error.status < 500) {
        return res.status(error.status).json({
            success: false,
            codigo: error.codigo,
            error: error.message,
        });
    }
    obs.captureException(error, { tipo: `ferramentas.${rotulo}` });
    logger.error(`[Ferramentas.${rotulo}] ${error.message}`);
    return res.status(500).json({ success: false, error: 'Erro ao processar a solicitação.' });
}

/** GET /api/ferramentas/catalogo — ferramentas controladas, por categoria. */
function catalogo(_req, res) {
    return res.json({ success: true, data: catalogoPorCategoria() });
}

/** GET /api/ferramentas/minhas — situação de cada ferramenta para quem está logado. */
async function minhas(req, res) {
    try {
        const data = await situacaoDoUsuario(req.user, req.escolaId);
        return res.json({ success: true, data });
    } catch (e) {
        return falha(res, 'minhas', e);
    }
}

/** GET /api/ferramentas/autorizacoes — quadro professores × ferramentas da escola. */
async function listarAutorizacoes(req, res) {
    if (!req.escolaId) return semEscola(res);
    try {
        const quadro = await quadroDaEscola(req.escolaId);
        return res.json({
            success: true,
            data: { categorias: catalogoPorCategoria(), ...quadro },
        });
    } catch (e) {
        return falha(res, 'listar', e);
    }
}

/**
 * PUT /api/ferramentas/autorizacoes — "Salvar autorizações".
 * Corpo: { alteracoes: [{ professorId, ferramentaId, autorizado }] }
 */
async function salvar(req, res) {
    if (!req.escolaId) return semEscola(res);
    try {
        const resultado = await salvarAutorizacoes({
            escolaId: req.escolaId,
            diretorId: String(req.user.id || req.user._id),
            alteracoes: req.body?.alteracoes,
            auditar: auditorDe(req),
        });
        return res.json({
            success: true,
            message: 'Autorizações salvas com sucesso.',
            data: {
                alteradas: resultado.alteradas.length,
                inalteradas: resultado.inalteradas,
                alteracoes: resultado.alteradas,
            },
        });
    } catch (e) {
        return falha(res, 'salvar', e);
    }
}

function auditorDe(req) {
    return (acao, detalhes) => logAction(req, acao, 'PermissaoFerramenta', detalhes);
}

/**
 * POST /api/ferramentas/:ferramentaId/solicitar — o professor pede a ferramenta.
 * Corpo opcional: { mensagem }. Professor e escola vêm da sessão.
 */
async function solicitar(req, res) {
    try {
        const { solicitacao, nova } = await solicitarFerramenta({
            usuario: req.user,
            escolaId: req.escolaId,
            ferramentaId: req.params.ferramentaId,
            mensagem: req.body?.mensagem,
            auditar: auditorDe(req),
        });
        return res.status(nova ? 201 : 200).json({
            success: true,
            message: nova
                ? 'Pedido enviado à direção.'
                : 'Você já tem um pedido aguardando a direção para esta ferramenta.',
            data: {
                id: String(solicitacao._id),
                ferramentaId: solicitacao.ferramentaId,
                status: solicitacao.status,
                criadaEm: solicitacao.createdAt,
                nova,
            },
        });
    } catch (e) {
        return falha(res, 'solicitar', e);
    }
}

/** GET /api/ferramentas/solicitacoes?status=pendente|autorizada|recusada|todas — direção. */
async function solicitacoes(req, res) {
    if (!req.escolaId) return semEscola(res);
    const status = ['pendente', 'autorizada', 'recusada', 'todas'].includes(req.query.status)
        ? req.query.status
        : 'pendente';
    try {
        return res.json({ success: true, data: await listarSolicitacoes(req.escolaId, status) });
    } catch (e) {
        return falha(res, 'solicitacoes', e);
    }
}

/**
 * POST /api/ferramentas/solicitacoes/:id/decidir — direção.
 * Corpo: { decisao: 'autorizar' | 'recusar', motivo? }
 */
async function decidir(req, res) {
    if (!req.escolaId) return semEscola(res);
    try {
        const pedido = await decidirSolicitacao({
            escolaId: req.escolaId,
            diretorId: String(req.user.id || req.user._id),
            solicitacaoId: req.params.id,
            decisao: req.body?.decisao,
            motivo: req.body?.motivo,
            auditar: auditorDe(req),
        });
        return res.json({
            success: true,
            message: pedido.status === 'autorizada' ? 'Ferramenta autorizada.' : 'Pedido recusado.',
            data: { id: String(pedido._id), status: pedido.status },
        });
    } catch (e) {
        return falha(res, 'decidir', e);
    }
}

module.exports = {
    catalogo,
    minhas,
    listarAutorizacoes,
    salvar,
    solicitar,
    solicitacoes,
    decidir,
};
