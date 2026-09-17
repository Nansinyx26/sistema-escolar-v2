/**
 * padronizadorResposta.js — Padronização e blindagem de respostas de erro da API.
 *
 * Garante o cumprimento da Issue #337 (Épico #334):
 * 1. Adiciona código de máquina (`codigo`) estável nas respostas de erro (400, 401, 403, 404, 413, 429, 500 etc.).
 * 2. Injeta `requestId` no corpo JSON do erro para correlação direta com os logs.
 * 3. Em produção, blinda respostas 500 substituindo mensagens de erro de drivers/banco
 *    por mensagem genérica opaca, registrando a mensagem real nos logs estruturados.
 * 4. Garante que `error` e `message` sejam sempre texto (string), nunca objeto vazio `{}`,
 *    mantendo compatibilidade 100% com o frontend (evitando "[object Object]").
 */

const logger = require('../utils/logger');

const CODIGOS_PADRAO = {
    400: 'REQUISICAO_INVALIDA',
    401: 'NAO_AUTENTICADO',
    403: 'NAO_AUTORIZADO',
    404: 'NAO_ENCONTRADO',
    413: 'CONTEUDO_MUITO_GRANDE',
    429: 'MUITAS_TENTATIVAS',
    500: 'ERRO_INTERNO',
    502: 'GATEWAY_INVALIDO',
    503: 'SERVICO_INDISPONIVEL',
};

const MENSAGEM_PADRAO_500 = 'Ocorreu um erro interno. Tente novamente.';

function padronizadorResposta(req, res, next) {
    const jsonOriginal = res.json.bind(res);

    res.json = (dados) => {
        if (dados && typeof dados === 'object' && !Buffer.isBuffer(dados)) {
            const status = res.statusCode || 200;

            if (status >= 400) {
                // Assegura success: false
                if (dados.success === undefined) {
                    dados.success = false;
                }

                // Injeta requestId no corpo da resposta
                const reqId = req.requestId || res.getHeader('X-Request-Id');
                if (reqId && !dados.requestId) {
                    dados.requestId = String(reqId);
                }

                // Injeta codigo de máquina correspondente ao status, preservando específico se já definido
                if (!dados.codigo && CODIGOS_PADRAO[status]) {
                    dados.codigo = CODIGOS_PADRAO[status];
                }

                const isProduction = process.env.NODE_ENV === 'production';

                if (status === 500) {
                    const erroOriginal = dados.error || dados.message;

                    if (isProduction) {
                        // Em produção: mascara detalhes internos
                        if (erroOriginal && erroOriginal !== MENSAGEM_PADRAO_500) {
                            const detalhe =
                                typeof erroOriginal === 'object'
                                    ? erroOriginal.message || JSON.stringify(erroOriginal)
                                    : String(erroOriginal);

                            logger.error('[Blindagem 500] Erro interno mascarado na resposta', {
                                erroOriginal: detalhe,
                                requestId: dados.requestId,
                                path: req.originalUrl || req.url,
                                method: req.method,
                            });
                        }

                        dados.error = MENSAGEM_PADRAO_500;
                        dados.message = MENSAGEM_PADRAO_500;
                    } else {
                        // Fora de produção: mantém erro legível para depuração, garantindo formato string
                        if (typeof dados.error === 'object' && dados.error !== null) {
                            dados.error = dados.error.message || String(dados.error);
                        } else if (!dados.error && dados.message) {
                            dados.error =
                                typeof dados.message === 'string'
                                    ? dados.message
                                    : String(dados.message);
                        }

                        if (!dados.message && dados.error) {
                            dados.message =
                                typeof dados.error === 'string' ? dados.error : String(dados.error);
                        }
                    }
                } else {
                    // Para 4xx, 502, 503: preserva mensagens de negócio
                    // Garante que 'error' nunca seja um objeto vazio ({})
                    if (typeof dados.error === 'object' && dados.error !== null) {
                        dados.error = dados.error.message || String(dados.error);
                    }

                    if (dados.message && !dados.error) {
                        dados.error =
                            typeof dados.message === 'string'
                                ? dados.message
                                : String(dados.message);
                    }

                    if (dados.error && !dados.message) {
                        dados.message =
                            typeof dados.error === 'string' ? dados.error : String(dados.error);
                    }
                }
            }
        }

        return jsonOriginal(dados);
    };

    next();
}

module.exports = {
    padronizadorResposta,
    CODIGOS_PADRAO,
    MENSAGEM_PADRAO_500,
};
