/**
 * observability/middleware.js — integração com o Express.
 *
 * Três peças, nesta ordem no app.js:
 *
 *   app.use(obs.middleware.request);      // logo no início
 *   ... rotas ...
 *   app.use(obs.middleware.errorHandler); // ANTES do handler de erro final
 *
 * O endpoint de health é montado por `obs.middleware.mountHealth(app)`.
 */

const config = require('./config');
const otel = require('./otel');
const providers = require('./providers');

/**
 * Enriquece o span ativo com dados da requisição e amarra a identidade do
 * usuário ao evento — sem PII, só o que serve para agrupar.
 */
function request(req, res, next) {
    if (config.disabled) return next();

    // `req.route` ainda não existe aqui; o path bruto basta e evita
    // cardinalidade infinita por causa de ID na URL.
    otel.annotate({
        'http.route': req.baseUrl || req.path,
        'escola.id': req.headers['x-escola-id'] || undefined,
    });

    // Correlaciona log ↔ trace ↔ erro. O front devolve isso no suporte.
    const traceId = otel.currentTraceId();
    if (traceId) {
        res.setHeader('X-Trace-Id', traceId);
        req.traceId = traceId;
    }

    // A identidade só existe depois do middleware de auth; por isso é lida
    // no fim da resposta, quando `req.user` já foi preenchido.
    res.on('finish', () => {
        if (req.user) providers.setUser(req.user);
    });

    next();
}

/**
 * Handler de erro. Reporta e repassa — NÃO responde ao cliente, para não
 * competir com o handler de erro que o app já tem.
 */
function errorHandler(err, req, _res, next) {
    if (config.disabled) return next(err);

    const status = err.status || err.statusCode || 500;

    // 4xx é erro de uso, não defeito do sistema. Reportar tudo transformaria
    // o painel em lixo e estouraria a cota do provedor.
    if (status >= 500) {
        providers.captureException(err, {
            metodo: req.method,
            rota: req.baseUrl || req.path,
            status,
            traceId: req.traceId,
        });
    }

    next(err);
}

/**
 * Monta `/api/health/observability`.
 * Só diz quais provedores estão ligados — nunca credencial nem endpoint.
 */
function mountHealth(app, path = '/api/health/observability') {
    app.get(path, (_req, res) => {
        const state = require('./status').status();
        res.json({
            ok: true,
            observabilidade: state,
            timestamp: new Date().toISOString(),
        });
    });
}

/**
 * Monta `POST /api/observability/frontend-error`.
 *
 * Por que o erro de front passa pelo backend em vez de ir direto ao Sentry:
 * a CSP do projeto trava `script-src` em `'self'` + hashes SHA-256 (ver
 * utils/cspHashes.js), então carregar o SDK do Sentry de CDN não executaria.
 * Encaminhar por aqui também garante que o mesmo scrub de PII do backend se
 * aplica ao que vem do navegador, e evita expor o DSN no HTML.
 */
function mountFrontendCollector(app, path = '/api/observability/frontend-error') {
    // Um navegador em laço de erro não pode virar negação de serviço.
    const janela = new Map(); // ip -> { count, resetAt }
    const LIMITE = 30;
    const JANELA_MS = 60_000;

    app.post(path, (req, res) => {
        if (config.disabled) return res.status(204).end();

        const agora = Date.now();
        const ip = req.ip || 'desconhecido';
        const registro = janela.get(ip);

        if (!registro || agora > registro.resetAt) {
            janela.set(ip, { count: 1, resetAt: agora + JANELA_MS });
        } else if (++registro.count > LIMITE) {
            return res.status(429).json({ ok: false });
        }

        // Limpeza preguiçosa, para o Map não crescer sem limite.
        if (janela.size > 5000) {
            for (const [chave, valor] of janela) {
                if (agora > valor.resetAt) janela.delete(chave);
            }
        }

        const corpo = req.body || {};
        const erro = new Error(String(corpo.message || 'Erro de frontend'));
        erro.name = String(corpo.name || 'FrontendError');
        if (corpo.stack) erro.stack = String(corpo.stack).slice(0, 8000);

        providers.captureException(erro, {
            origem: 'frontend',
            pagina: corpo.pagina,
            userAgent: req.headers['user-agent'],
            traceId: req.traceId,
        });

        res.status(202).json({ ok: true });
    });
}

module.exports = { request, errorHandler, mountHealth, mountFrontendCollector };
