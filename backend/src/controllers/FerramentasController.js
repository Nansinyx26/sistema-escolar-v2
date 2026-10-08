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
            auditar: (acao, detalhes) => logAction(req, acao, 'PermissaoFerramenta', detalhes),
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

module.exports = { catalogo, minhas, listarAutorizacoes, salvar };
