/**
 * exigirFerramenta.js — barreira de uma ferramenta que depende de autorização
 * da direção (Issue #720).
 *
 *   router.post('/plano-aula', exigirFerramenta('ia.plano-aula'), handler)
 *
 * Precisa de `authJWT` (req.user) e `filtrarPorEscola` (req.escolaId) antes —
 * a escola vem da sessão, nunca da requisição. Esconder o botão na tela não
 * basta: é aqui que o professor sem autorização recebe 403, mesmo montando a
 * requisição à mão.
 *
 * A resposta 403 diz qual ferramenta faltou e se já há pedido pendente, para
 * a tela oferecer "Solicitar autorização" sem outra consulta.
 */
const obs = require('../observability');
const logger = require('../utils/logger');
const { ferramentaPorId } = require('../services/ferramentas/catalogo');
const {
    checkToolPermission,
    temSolicitacaoPendente,
} = require('../services/ferramentas/permissaoFerramenta');

const CODIGO_NAO_AUTORIZADA = 'FERRAMENTA_NAO_AUTORIZADA';

function exigirFerramenta(ferramentaId) {
    const ferramenta = ferramentaPorId(ferramentaId);
    // Erro de programação, não de usuário: uma rota protegida por uma chave
    // que não existe no catálogo nunca liberaria ninguém. Falha na subida.
    if (!ferramenta) {
        throw new Error(`exigirFerramenta: "${ferramentaId}" não está no catálogo de ferramentas.`);
    }

    return async function exigirFerramentaMiddleware(req, res, next) {
        try {
            const { liberado } = await checkToolPermission(req.user, req.escolaId, ferramenta.id);
            if (liberado) return next();

            const usuarioId = String(req.user?.id || req.user?._id || '');
            const pendente = await temSolicitacaoPendente(usuarioId, req.escolaId, ferramenta.id);
            return res.status(403).json({
                success: false,
                codigo: CODIGO_NAO_AUTORIZADA,
                error: `A ferramenta "${ferramenta.nome}" precisa de autorização da direção.`,
                ferramenta: { id: ferramenta.id, nome: ferramenta.nome },
                solicitacaoPendente: pendente,
            });
        } catch (e) {
            // Sem conseguir ler a decisão, nega: liberar por falha de banco
            // seria entregar a ferramenta a quem a direção não autorizou.
            obs.captureException(e, { tipo: 'ferramentas.verificar', ferramentaId: ferramenta.id });
            logger.error(`[exigirFerramenta] ${e.message}`);
            return res.status(503).json({
                success: false,
                error: 'Não foi possível conferir a autorização desta ferramenta. Tente novamente.',
            });
        }
    };
}

module.exports = { exigirFerramenta, CODIGO_NAO_AUTORIZADA };
