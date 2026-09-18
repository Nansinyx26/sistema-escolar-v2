/**
 * pagination.js — Middleware de Paginação
 *
 * Padroniza paginação em todos os endpoints de listagem.
 * Extrai page e limit da query string, aplica defaults e limites.
 *
 * Uso:
 *   app.get('/api/comunicados', pagination(20, 100), ComunicadoController.list);
 *
 * Query string:
 *   ?page=1&limit=20
 *   Resposta inclui: { data: [], pagination: { page, limit, total, pages } }
 */

/**
 * Factory function que retorna middleware de paginação
 *
 * @param {number} defaultLimit - Limite padrão (ex: 20)
 * @param {number} maxLimit - Limite máximo permitido (ex: 100)
 * @returns {Function} Middleware Express
 */
function pagination(defaultLimit = 20, maxLimit = 100) {
    return (req, res, next) => {
        try {
            // Extrair page e limit da query string
            let page = parseInt(req.query.page, 10) || 1;
            let limit = parseInt(req.query.limit, 10) || defaultLimit;

            // Validações
            if (page < 1) page = 1;
            if (limit < 1) limit = 1;
            if (limit > maxLimit) limit = maxLimit;

            // Calcular skip para MongoDB
            const skip = (page - 1) * limit;

            // Armazenar no req para uso no controller
            req.pagination = {
                page,
                limit,
                skip,
                // Helper para contar páginas totais
                calculatePages: (total) => Math.ceil(total / limit),
            };

            next();
        } catch (error) {
            res.status(400).json({
                success: false,
                error: 'Parâmetros de paginação inválidos',
                details: error.message,
            });
        }
    };
}

/**
 * Helper para formatar resposta paginada
 * Usar no controller após buscar dados
 *
 * @param {Object} data - Array de dados
 * @param {number} total - Total de documentos (sem limit)
 * @param {Object} pagination - req.pagination
 * @returns {Object} Resposta formatada
 *
 * Exemplo de uso no controller:
 *   const data = await Comunicado.find().skip(...).limit(...).lean();
 *   const total = await Comunicado.countDocuments();
 *   res.json(formatPaginatedResponse(data, total, req.pagination));
 */
function formatPaginatedResponse(data, total, pagination) {
    const pages = pagination.calculatePages(total);
    const hasNextPage = pagination.page < pages;
    const hasPrevPage = pagination.page > 1;

    return {
        success: true,
        data,
        pagination: {
            page: pagination.page,
            limit: pagination.limit,
            total,
            pages,
            hasNextPage,
            hasPrevPage,
            nextPage: hasNextPage ? pagination.page + 1 : null,
            prevPage: hasPrevPage ? pagination.page - 1 : null,
        },
    };
}

/**
 * Extrai e normaliza parâmetros de paginação da query string.
 * Retorna null quando nenhum parâmetro de paginação foi fornecido (mantendo compatibilidade).
 * Reduz automaticamente limites que excedam maxLimit (Issue #338).
 *
 * @param {Object} query - req.query
 * @param {number} defaultLimit - Limite padrão caso limit não seja enviado (padrão: 20)
 * @param {number} maxLimit - Limite máximo permitido (padrão: 100)
 * @returns {Object|null}
 */
function extrairPaginacao(query = {}, defaultLimit = 20, maxLimit = 100) {
    const temPaginacao = query.page !== undefined || query.limit !== undefined;
    if (!temPaginacao) return null;

    const page = Math.max(1, parseInt(query.page, 10) || 1);
    const parsedLimit = parseInt(query.limit, 10) || defaultLimit;
    const limit = Math.min(maxLimit, Math.max(1, parsedLimit));
    const skip = (page - 1) * limit;

    return {
        page,
        limit,
        skip,
        formatarResposta(data, total) {
            const pages = Math.ceil(total / limit);
            const hasNextPage = page < pages;
            const hasPrevPage = page > 1;

            return {
                success: true,
                data,
                pagination: {
                    page,
                    limit,
                    total,
                    pages,
                    hasNextPage,
                    hasPrevPage,
                    nextPage: hasNextPage ? page + 1 : null,
                    prevPage: hasPrevPage ? page - 1 : null,
                },
            };
        },
    };
}

module.exports = {
    pagination,
    formatPaginatedResponse,
    extrairPaginacao,
};
