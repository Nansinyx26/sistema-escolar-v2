const express = require('express');
const path = require('path');
const cookieParser = require('cookie-parser');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
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

// Middleware de Segurança (Helmet)
// ============================================
// TODO(security): migrar os poucos <script> inline restantes do frontend
// legado para arquivos externos ou nonces por rota, permitindo endurecer
// ainda mais a CSP sem exceções adicionais.
// ============================================
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            "default-src": ["'self'"],
            "script-src": ["'self'", "'unsafe-inline'", "cdn.jsdelivr.net", "unpkg.com", "cdnjs.cloudflare.com", "cdn.tailwindcss.com", "https://accounts.google.com"],
            "script-src-attr": ["'unsafe-inline'"],
            "style-src": ["'self'", "'unsafe-inline'", "cdn.jsdelivr.net", "fonts.googleapis.com", "unpkg.com", "cdnjs.cloudflare.com", "https://accounts.google.com"],
            "font-src": ["'self'", "cdn.jsdelivr.net", "fonts.gstatic.com", "data:"],
            // Google profile photos (lh3.googleusercontent.com) + blobs/data URIs
            "img-src": ["'self'", "data:", "blob:", "https://lh3.googleusercontent.com", "https://lh4.googleusercontent.com", "https://lh5.googleusercontent.com", "https://lh6.googleusercontent.com"],
            // CRÍTICO: www.googleapis.com é necessário para o fluxo OAuth do Google
            "media-src": ["'self'", "blob:"],
            // (useGoogleLogin chama /oauth2/v3/userinfo após o popup fechar)
            "connect-src": [
                "'self'", 
                "https://sistema-escolar-bfty.onrender.com", 
                "http://localhost:*", 
                "http://127.0.0.1:*",
                "ws://localhost:*",
                "ws://127.0.0.1:*",
                "wss://sistema-escolar-bfty.onrender.com",
                "cdn.tailwindcss.com",
                "https:",
                "http:",
                "ws:",
                "wss:",
                "data:",
                "blob:"
            ],
            "frame-src": ["'self'", "https://accounts.google.com"], // Necessário para o Iframe de login do Google
            "frame-ancestors": ["'none'"], // Proteção extra contra Clickjacking
            "base-uri": ["'self'"],         // Previne ataques de base tag injection
            "form-action": ["'self'"]       // Previne submissão de formulários para domínios externos
        }
    },
    // Necessário para o popup do Google OAuth comunicar de volta com a página pai
    crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' },
    crossOriginEmbedderPolicy: false, // Desabilitado para compatibilidade com CDNs
}));

// ============================================
// SERVIR ARQUIVOS ESTÁTICOS (Antes de qualquer rate limiter)
// ============================================
const frontendRootPath = path.join(__dirname, '../../');
const staticDirectories = [
    'css',
    'js',
    'img',
    'html',
    'detalhes',
    'direcao',
    'graficos',
    'favicon',
    'portal-responsavel/dist'
];
const staticFiles = [
    'index.html',
    'manifest.json',
    'sw.js',
    'service-worker.js',
    'favicon.ico',
    'favicon.svg'
];
const staticOptions = {
    setHeaders: (res, filePath) => {
        if (filePath.endsWith('.woff2')) res.setHeader('Content-Type', 'font/woff2');
        if (filePath.endsWith('.woff')) res.setHeader('Content-Type', 'font/woff');
    }
};

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

// Rate Limiter Global (Proteção contra DoS em chamadas de API)
const isProduction = process.env.NODE_ENV === 'production';
const isTest = process.env.NODE_ENV === 'test';

const globalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: isProduction ? 2000 : 5000,
    message: { success: false, error: 'Muitas requisições vindas deste IP. Tente novamente mais tarde.' },
    skip: (req) => isTest || !req.path.startsWith('/api')
});

// Aplicar o globalLimiter APENAS em rotas /api
app.use('/api', globalLimiter);

// Rate Limiter Especifico para Autenticacao (Brute Force)
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: isProduction ? 15 : 200,
    skip: () => isTest,
    message: {
        success: false,
        error: 'Muitas tentativas de login ou recuperação. Tente novamente em 15 minutos.'
    },
    standardHeaders: true,
    legacyHeaders: false,
});

// Limiter agressivo para endpoints que validam SEGREDOS curtos
const codeLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hora
    max: isProduction ? 30 : 300,
    skip: () => isTest,
    message: {
        success: false,
        error: 'Muitas tentativas de verificação de código. Tente novamente mais tarde.'
    },
    standardHeaders: true,
    legacyHeaders: false,
});

// Limiter do prefixo /api/auth
const authPrefixLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: isProduction ? 60 : 600,
    skip: (req) => isTest || req.method === 'GET' || req.method === 'HEAD',
    message: {
        success: false,
        error: 'Muitas requisições de autenticação. Tente novamente em 15 minutos.'
    },
    standardHeaders: true,
    legacyHeaders: false,
});

// CORS - Configurado para desenvolvimento e produção
const allowedOrigins = [
    'http://localhost:3000',
    'http://localhost:3001',
    'http://localhost:5173',
    'http://localhost:5174',
    'http://localhost:5500',
    'http://127.0.0.1:3001',
    'http://127.0.0.1:5500',
    'https://sistema-escolar-bfty.onrender.com',
    process.env.FRONTEND_URL
].filter(Boolean); // Remove undefined/null

app.use(cors({
    origin: function (origin, callback) {
        // Permitir requisições sem origin (ex: Postman, mobile apps)
        if (!origin) return callback(null, true);

        // Em desenvolvimento, permite todos
        if (process.env.NODE_ENV !== 'production') {
            return callback(null, true);
        }

        // Em produção, checa lista de permitidos (exata, sem wildcard)
        if (allowedOrigins.includes(origin)) {
            callback(null, true);
        } else {
            console.error(`❌ Bloqueado por CORS: ${origin}`);
            callback(new Error(`Not allowed by CORS (Origin: ${origin})`));
        }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-migration-key', 'X-API-Key', 'X-CSRF-Token']
}));

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
        maxAge: 8 * 60 * 60 * 1000 // mesmo horizonte do JWT (8h)
    }
};
if (process.env.MONGODB_URI && process.env.NODE_ENV !== 'test') {
    const connectMongo = require('connect-mongo');
    const MongoStore = connectMongo.default || connectMongo; // compat CJS/ESM
    sessionOptions.store = MongoStore.create({
        mongoUrl: process.env.MONGODB_URI,
        dbName: process.env.MONGODB_DB_NAME || undefined,
        collectionName: 'sessions',
        ttl: 8 * 60 * 60
    });
}
app.use(session(sessionOptions));

// Body Parser - Limite reduzido para 1MB para prevenir DoS
app.use(express.json({ limit: '1mb' })); 
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// Middlewares locais para uploads de fotos (permitem até 10MB)
const photoLimit = express.json({ limit: '10mb' });
app.use('/api/alunos', (req, res, next) => req.method === 'POST' ? photoLimit(req, res, next) : next());
app.use('/api/upload/photo', photoLimit);
// Upload de foto de perfil via base64 — precisa do limite estendido
app.use('/api/usuarios/foto', (req, res, next) => req.method === 'PUT' ? photoLimit(req, res, next) : next());
// Comunicados podem include imagens base64 — precisa do limite estendido
app.use('/api/comunicados', (req, res, next) => (req.method === 'POST' || req.method === 'PUT') ? photoLimit(req, res, next) : next());

// Sanitização Global de Inputs (XSS e NoSQL Injection Protection)
// req.query e req.params também passam aqui: com `extended: true` o Express
// transforma ?campo[$ne]=x num OBJETO, que ia direto para o filtro Mongo dos
// controllers (ex.: /api/professores?ativo[$ne]=false devolvia a rede inteira).
app.use((req, res, next) => {
    if (req.body) sanitizeObject(req.body);
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
                .filter(v => typeof v !== 'object' || v === null)
                .map(v => (typeof v === 'string' ? sanitizeInput(v) : v));
        } else if (valor && typeof valor === 'object') {
            // ?campo[$ne]=x → objeto. Nada legítimo em query string precisa
            // de operadores Mongo, então o parâmetro inteiro é descartado.
            delete alvo[chave];
        } else if (typeof valor === 'string') {
            alvo[chave] = sanitizeInput(valor);
        }
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
app.use('/api/auth/2fa/verify', codeLimiter);
app.use('/api/auth/2fa/send', codeLimiter);
app.use('/api/auth/validate-code', codeLimiter);
app.use('/api/auth/verify-recovery-code', codeLimiter);
app.use('/api/responsavel/vincular', codeLimiter);
app.use('/api/responsavel/buscar-aluno', codeLimiter);

// Os três endpoints historicamente mais atacados mantêm o teto mais baixo
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/forgot-password', authLimiter);
app.use('/api/auth/reset-password', authLimiter);

// Todo o restante do prefixo /api/auth — cadastro, ativação e 2FA.
// Antes só login/forgot/reset eram cobertos, deixando register-diretor,
// register-code e os endpoints de 2FA sem qualquer freio.
app.use('/api/auth', authPrefixLimiter);

// Rotas
app.use('/api', apiRoutes);

// 404 global: rota desconhecida NÃO mascara mais como landing page.
// API → JSON; navegação → página de erro amigável (dark theme) com
// retorno seguro ao painel do perfil logado.
app.use((req, res) => {
    if (req.path.startsWith('/api')) {
        return res.status(404).json({ success: false, error: 'Endpoint não encontrado' });
    }
    res.status(404).sendFile(path.join(frontendRootPath, 'html', '404.html'));
});

// Tratamento de Erro (Opaco em Produção — não vaza stack traces)
app.use((err, req, res, next) => {
    // Payload Too Large — imagens muito grandes
    if (err.type === 'entity.too.large' || err.status === 413) {
        return res.status(413).json({
            success: false,
            error: 'O tamanho total das imagens excede o limite permitido (10MB). Reduza o tamanho ou quantidade das imagens.'
        });
    }

    const statusCode = err.status || 500;

    logger.error(`[Error Handler] ${err.message}`, {
        requestId: req.requestId,
        method: req.method,
        path: req.originalUrl,
        status: statusCode,
        stack: process.env.NODE_ENV !== 'production' ? err.stack : undefined,
    });

    // Alerta automático para erros 5xx no handler global
    if (statusCode >= 500) {
        logger.alert('UNHANDLED_ERROR', err.message, {
            requestId: req.requestId,
            path: req.originalUrl,
        });
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
        error: isProduction ? {} : err
    });
});

module.exports = app;
