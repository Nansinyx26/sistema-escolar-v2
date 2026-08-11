/**
 * requestLogger.js — Métricas HTTP + escopo de contexto de log
 *
 * Duas responsabilidades:
 *   1. Abre o escopo do AsyncLocalStorage para a requisição. A partir daqui,
 *      QUALQUER `logger.*()` chamado na pilha — controller, service, model —
 *      sai carimbado com requestId/userId/escolaId sem receber `req`.
 *   2. Registra a linha de acesso no `finish` (status, duração, tamanho) e
 *      dispara alertas para 5xx e requisições lentas.
 *
 * Ordem em app.js: este middleware precisa vir ANTES das rotas e do authJWT,
 * para que o contexto já exista quando o auth preencher o userId.
 */

const logger = require('../utils/logger');
const logContext = require('../utils/logContext');
const monitoring = require('../services/MonitoringService');

/** Duração em ms com relógio monotônico (imune a ajuste de hora do sistema). */
function getDurationMs(start) {
    const diff = process.hrtime(start);
    return Math.round(diff[0] * 1e3 + diff[1] / 1e6);
}

/**
 * Nome estável da rota, para agrupar métrica.
 *
 * Usar o caminho cru daria uma entrada por ID — `/api/alunos/507f...`,
 * `/api/alunos/610a...` — e a estatística por rota viraria uma lista infinita
 * de linhas com uma requisição cada, inútil para diagnóstico e perigosa para a
 * memória do processo.
 *
 * O template do Express (`/api/alunos/:id`) resolve isso quando alguma rota
 * casa. Quando não casa (404, arquivo estático), o caminho é normalizado à mão
 * trocando segmentos que parecem identificador.
 */
function rotaNormalizada(req) {
    const metodo = req.method;

    if (req.route?.path) {
        const base = req.baseUrl || '';
        const trecho = req.route.path === '/' ? '' : req.route.path;
        const template = `${base}${trecho}`;

        // O template só serve se tiver ao menos um segmento FIXO. Sem esta
        // checagem, um `app.get('/:id')` de nível superior — que existe para
        // servir HTML — captura /api/turmas/<id> e devolve o template `/:id`,
        // com baseUrl vazio. URLs sem relação nenhuma cairiam todas na mesma
        // linha do painel, e a estatística deixaria de significar qualquer
        // coisa. É o problema de cardinalidade ao contrário: em vez de linhas
        // demais, uma linha que não diz nada.
        const temSegmentoFixo = template.split('/').some((seg) => seg && !seg.startsWith(':'));

        if (temSegmentoFixo) return `${metodo} ${template}`;
    }

    // Sem template utilizável: normaliza o caminho real, trocando o que parece
    // identificador. Preserva o prefixo, que é o que dá sentido à linha.
    //
    // `originalUrl`, e NÃO `req.path`: dentro de um router montado, `req.path`
    // é relativo ao ponto de montagem. Numa requisição a /api/turmas/<id>
    // barrada pelo middleware de autenticação — onde `req.route` nem chega a
    // existir — `req.path` vale só `/<id>`, e a linha do painel viraria `/:id`,
    // juntando rotas sem relação nenhuma.
    const caminho = (req.originalUrl || req.url || '/').split('?')[0];
    const generico = caminho
        .split('/')
        .map((seg) => (/^[0-9a-f]{8,}$/i.test(seg) || /^\d+$/.test(seg) ? ':id' : seg))
        .join('/');

    return `${metodo} ${generico}`;
}

function requestLogger(req, res, next) {
    // Health checks e assets não geram linha de acesso (ruído puro), mas ainda
    // assim recebem contexto — um erro dentro deles precisa ser rastreável.
    const skipPaths = ['/api/health', '/api/ping', '/favicon'];
    const silent = skipPaths.some((p) => req.path.startsWith(p));

    const start = process.hrtime();
    const requestId = logContext.generateRequestId();

    req.requestId = requestId;
    // Devolve o id ao cliente: um usuário que reporta erro traz o id do incidente.
    res.setHeader('X-Request-Id', requestId);

    const baseContext = {
        requestId,
        method: req.method,
        path: req.originalUrl || req.url,
    };

    logContext.run(baseContext, () => {
        res.on('finish', () => {
            if (silent) return;

            const durationMs = getDurationMs(start);
            const statusCode = res.statusCode;

            monitoring.recordRequest(statusCode, durationMs, rotaNormalizada(req));

            const clientIp = String(
                req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress || '0.0.0.0'
            )
                .split(',')[0]
                .trim();

            const meta = {
                status: statusCode,
                durationMs,
                contentLength: Number(res.getHeader('content-length') || 0),
                ip: clientIp,
                userAgent: String(req.headers['user-agent'] || '').substring(0, 120),
            };
            // requestId/userId/escolaId entram sozinhos pelo contexto — não repetir aqui.

            const line = `${req.method} ${req.originalUrl} → ${statusCode} (${durationMs}ms)`;

            if (statusCode >= 500) {
                logger.error(line, meta);
                logger.alert(
                    'HTTP_5XX',
                    `Erro ${statusCode} em ${req.method} ${req.originalUrl}`,
                    meta
                );
            } else if (statusCode >= 400) {
                logger.warn(line, meta);
            } else {
                logger.info(line, meta);
            }

            if (durationMs > 5000) {
                logger.alert(
                    'SLOW_REQUEST',
                    `Requisição lenta em ${req.method} ${req.originalUrl}`,
                    {
                        durationMs,
                        threshold: 5000,
                    }
                );
            }
        });

        next();
    });
}

module.exports = { requestLogger };
