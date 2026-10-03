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
 * 5. Em produção, mascara também a mensagem com cara de erro interno em QUALQUER
 *    status de erro, e tira do 500 os campos de detalhe (Issue #599).
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
const MENSAGEM_PADRAO_4XX =
    'Não foi possível processar a requisição. Confira os dados e tente novamente.';

/**
 * Formatos de mensagem que só um erro interno produz (Issue #599).
 *
 * A blindagem do item 3 cobria só o status 500. Um `catch` genérico que
 * responde 400 com `e.message` — padrão comum nos controllers de cadastro —
 * mandava ao cliente o texto do Mongoose como veio: nome de coleção, índice,
 * campo e modelo (`Cast to ObjectId failed … for model "Aluno"`,
 * `E11000 duplicate key error collection: … index: email_1`). O mesmo valia
 * para um 503 com `ECONNREFUSED host:porta`.
 *
 * Reconhecer o formato, em vez de trocar toda mensagem de 4xx, preserva o que
 * o usuário precisa ler ("Campo nome é obrigatório"): mensagem de negócio é
 * escrita em português pelo próprio sistema, nenhuma casa com estes padrões.
 */
const PADROES_ERRO_INTERNO = [
    /\bvalidation failed\b/i, // ValidationError do Mongoose
    /\bCast to \w+ failed\b/i, // CastError do Mongoose
    /\bE11000\b|duplicate key error/i, // índice único do Mongo
    /\bMongo(Server|Network|Parse|Bulk|Write)?Error\b|\bMongooseError\b/,
    /buffering timed out|Server selection timed out/i,
    /\bE(CONNREFUSED|CONNRESET|TIMEDOUT|NOTFOUND|AI_AGAIN|PIPE)\b/,
    /Cannot read propert(y|ies) of|\bis not a function\b|\bis not defined\b|\bis not iterable\b/,
    /\bat \S+ \(\S+:\d+:\d+\)/, // linha de stack trace
];

/** Campos que só servem para depurar: não saem em erro 500 de produção. */
const CAMPOS_DE_DETALHE = ['details', 'detalhes', 'detalhe', 'stack'];

function pareceErroInterno(valor) {
    if (typeof valor !== 'string' || valor === '') return false;
    return PADROES_ERRO_INTERNO.some((padrao) => padrao.test(valor));
}

/**
 * Em produção, troca por `generica` a mensagem de erro interno que um status
 * diferente de 500 carregava, e registra a original no log (o logger mascara
 * e-mail e CPF que um `E11000 … dup key` traria).
 */
function mascararErroInterno(req, dados, status, generica) {
    const campos = ['error', 'message', ...CAMPOS_DE_DETALHE];
    const vazados = campos.filter((campo) => pareceErroInterno(dados[campo]));
    if (vazados.length === 0) return;

    const registro = {
        erroOriginal: vazados.map((campo) => String(dados[campo])).join(' | '),
        status,
        requestId: dados.requestId,
        path: req.originalUrl || req.url,
        method: req.method,
    };
    // 4xx não é erro do servidor (Issue #109): fica fora do canal de erro.
    if (status >= 500) logger.error('[Blindagem 5xx] Erro interno mascarado', registro);
    else logger.warn('[Blindagem 4xx] Erro interno mascarado', registro);

    for (const campo of vazados) {
        if (campo === 'error' || campo === 'message') dados[campo] = generica;
        else delete dados[campo];
    }
}

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
                        // `error`/`message` não eram os únicos campos com o erro:
                        // havia 500 respondendo `details: error.message` (#599).
                        for (const campo of CAMPOS_DE_DETALHE) delete dados[campo];
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

                    // ...mas não a mensagem que é erro interno (Issue #599).
                    if (isProduction) {
                        const generica = status >= 500 ? MENSAGEM_PADRAO_500 : MENSAGEM_PADRAO_4XX;
                        mascararErroInterno(req, dados, status, generica);
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
    pareceErroInterno,
    CODIGOS_PADRAO,
    MENSAGEM_PADRAO_500,
    MENSAGEM_PADRAO_4XX,
};
