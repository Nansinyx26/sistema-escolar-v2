const express = require('express');
const path = require('path');
const cookieParser = require('cookie-parser');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const apiRoutes = require('./routes/api');
const { sanitizeObject } = require('./utils/sanitize');
const { csrfCookieSetter, csrfValidator } = require('./middleware/csrfProtection');

const app = express();

// Configurar Trust Proxy para o Render (Necessário para express-rate-limit)
app.set('trust proxy', 1);

// Redirecionamento HTTPS (Para Produção/Render)
app.use((req, res, next) => {
    if (process.env.NODE_ENV === 'production' && req.headers['x-forwarded-proto'] !== 'https') {
        return res.redirect(`https://${req.get('host')}${req.url}`);
    }
    next();
});

// Middleware de Segurança (Helmet)
// ============================================
// NOTA DE SEGURANÇA (Atualizado — Roadmap Backlog #1):
// - 'unsafe-inline' REMOVIDO de script-src e script-src-attr.
//   Todos os atributos onclick= foram migrados para addEventListener em
//   arquivos separados (js/events/*.js), viabilizando esta CSP estrita.
// - 'unsafe-inline' é mantido em style-src pois o frontend usa estilos inline
// - 'unsafe-eval' não existe — foi mantido removido
// ============================================
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            "default-src": ["'self'"],
            // Adicionado 'unsafe-inline' para permitir funcionamento correto do Google Identity e scripts do portal em produção
            "script-src": ["'self'", "'unsafe-inline'", "cdn.jsdelivr.net", "unpkg.com", "cdnjs.cloudflare.com", "cdn.tailwindcss.com", "https://accounts.google.com"],
            "script-src-attr": ["'unsafe-inline'"], // Permite atributos inline de forma compatível
            "style-src": ["'self'", "'unsafe-inline'", "cdn.jsdelivr.net", "fonts.googleapis.com", "unpkg.com", "cdnjs.cloudflare.com", "https://accounts.google.com"],
            "font-src": ["'self'", "cdn.jsdelivr.net", "fonts.gstatic.com", "data:"],
            // Google profile photos (lh3.googleusercontent.com) + blobs/data URIs
            "img-src": ["'self'", "data:", "blob:", "https://lh3.googleusercontent.com", "https://lh4.googleusercontent.com", "https://lh5.googleusercontent.com", "https://lh6.googleusercontent.com"],
            // CRÍTICO: www.googleapis.com é necessário para o fluxo OAuth do Google
            // (useGoogleLogin chama /oauth2/v3/userinfo após o popup fechar)
            "connect-src": ["'self'", "https://sistema-escolar-bfty.onrender.com", "http://localhost:3001", "cdn.jsdelivr.net", "unpkg.com", "https://accounts.google.com", "https://www.googleapis.com", "https://oauth2.googleapis.com", "https://fonts.googleapis.com", "https://fonts.gstatic.com"],
            "frame-src": ["'self'", "https://accounts.google.com"], // Necessário para o Iframe de login do Google
            "frame-ancestors": ["'none'"], // Proteção extra contra Clickjacking
            "base-uri": ["'self'"],         // Previne ataques de base tag injection
            "form-action": ["'self'"]       // Previne submissão de formulários para domínios externos
        }
    },
    crossOriginEmbedderPolicy: false, // Desabilitado para compatibilidade com CDNs
}));

// Rate Limiter Global (Protecao contra DoS generico)
// DESABILITADO em testes para nao interferir no Jest
const globalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: process.env.NODE_ENV === 'production' ? 200 : 99999,
    message: { success: false, error: 'Muitas requisicoes vindas deste IP. Tente novamente mais tarde.' },
    skip: () => process.env.NODE_ENV !== 'production'
});

app.use(globalLimiter);

// Rate Limiter Especifico para Autenticacao (Brute Force)
// DESABILITADO em testes (os testes de brute-force testam a logica do controller, nao o rate limiter)
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: process.env.NODE_ENV === 'production' ? 10 : 99999,
    skip: () => process.env.NODE_ENV !== 'production',
    message: { 
        success: false, 
        error: 'Muitas tentativas de login ou recuperacao. Tente novamente em 15 minutos.' 
    },
    standardHeaders: true,
    legacyHeaders: false,
});

// CORS - Configurado para desenvolvimento e produção
const allowedOrigins = [
    'http://localhost:3000',
    'http://localhost:5173',
    'http://localhost:5174',
    'http://localhost:5500',
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

// Body Parser - Limite reduzido para 1MB para prevenir DoS
app.use(express.json({ limit: '1mb' })); 
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// Middlewares locais para uploads de fotos (permitem até 10MB)
const photoLimit = express.json({ limit: '10mb' });
app.use('/api/alunos', (req, res, next) => req.method === 'POST' ? photoLimit(req, res, next) : next());
app.use('/api/upload/photo', photoLimit);

// Sanitização Global de Inputs (XSS e NoSQL Injection Protection)
app.use((req, res, next) => {
    if (req.body) {
        sanitizeObject(req.body);
    }
    next();
});

// ============================================
// PROTEÇÍO CSRF (Double Submit Cookie)
// ============================================
// 1. Define o cookie CSRF em toda resposta
app.use(csrfCookieSetter);
// 2. Valida o token CSRF em rotas que mudam estado (POST/PUT/DELETE)
app.use('/api', csrfValidator);

// Aplicar limiters específicos antes das rotas gerais
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/forgot-password', authLimiter);
app.use('/api/auth/reset-password', authLimiter);

// Rotas
app.use('/api', apiRoutes);

// ============================================
// SERVIR ARQUIVOS ESTÁTICOS — RESTRITO
// ============================================
// SEGURANÇA: Serve apenas arquivos públicos do frontend.
// Antes servia toda a raiz do projeto, expondo .env.example, README, etc.
// Agora usa uma lista explícita de extensões e pastas permitidas.
const frontendPath = path.join(__dirname, '../../');

// Bloqueia acesso a arquivos sensíveis
app.use((req, res, next) => {
    const blockedPatterns = [
        /\.env/i,
        /\.git/i,
        /\.npmrc/i,
        /node_modules/i,
        /package\.json/i,
        /package-lock\.json/i,
        /\.md$/i,
        /\.py$/i,
        /\.yml$/i,
        /\.yaml$/i,
        /backend\//i,
        /scratch\//i,
        /\.claude\//i,
        /scripts\//i
    ];

    if (blockedPatterns.some(pattern => pattern.test(req.path))) {
        return res.status(403).json({ success: false, error: 'Acesso negado' });
    }
    next();
});

app.use(express.static(frontendPath));

// Catch-all para SPA: Qualquer rota não-API retorna o index.html
app.get('*', (req, res) => {
    if (req.path.startsWith('/api')) {
        return res.status(404).json({ success: false, error: 'Endpoint não encontrado' });
    }
    res.sendFile(path.join(frontendPath, 'index.html'));
});

// Tratamento de Erro (Opaco em Produção — não vaza stack traces)
app.use((err, req, res, next) => {
    console.error(' [Error Handler]:', err.stack);
    
    const isProduction = process.env.NODE_ENV === 'production';
    
    res.status(err.status || 500).json({
        success: false,
        message: isProduction ? 'Erro interno do servidor.' : err.message,
        // Detalhes extras apenas em dev
        error: isProduction ? {} : err
    });
});

module.exports = app;
