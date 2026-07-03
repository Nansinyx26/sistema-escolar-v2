const path = require('path');
const dotenv = require('dotenv');

// Carrega variáveis de ambiente do .env do backend ou do .env da raiz
dotenv.config({ path: path.join(__dirname, '../.env') });
dotenv.config({ path: path.join(__dirname, '../../.env') });


// Patch global do nodemailer para contornar bloqueio de porta SMTP no Render
require('./utils/nodemailerPatch');

const app = require('./app');
const connectDB = require('./utils/db');
const { initializeCache } = require('./services/CacheService');
const { startKeepAlive } = require('./utils/keepAlive');                          // MELHORIA: Previne cold start (Roadmap #5)
const { startAnonimizacaoAutomatica } = require('./utils/anonimizacaoAutomatica'); // MELHORIA: LGPD cron (Roadmap #14)
const cron = require('node-cron');
const SecurityController = require('./controllers/SecurityController');
const SecurityConfig = require('./models/SecurityConfig');
const { initializeSecretCodes } = require('./utils/secretCodeHelper');
const logger = require('./utils/logger');
const { startHealthMonitor } = require('./utils/healthMonitor');

const PORT = process.env.PORT || 3001;

const startServer = async () => {
    try {
        // 1. Conectar ao Banco de Dados primeiro
        await connectDB();

        // 1b. Inicializar cache virtual (Redis ou Node-cache)
        await initializeCache();

        // Inicializa códigos secretos ausentes dos alunos
        await initializeSecretCodes();

        // Migração silenciosa: garante que todos os usuários têm os campos
        // de preferência de voz/TTS/acessibilidade (roda em background)
        _runVoiceMigrationSilent().catch(err =>
            logger.warn('[Boot] Migração de voz falhou silenciosamente:', err.message)
        );

        // 2. Iniciar Servidor somente se o banco estiver OK
        const server = app.listen(PORT, () => {
            logger.info(`✅ Servidor iniciado`, { mode: process.env.NODE_ENV, port: PORT });

            // 3. Ativa keep-alive para prevenir cold start no Render Free
            startKeepAlive();
            // 4. Ativa cron de anonimização automática (LGPD)
            startAnonimizacaoAutomatica();
            // 5. Ativa health monitor periódico (Roadmap #6)
            startHealthMonitor();

            // 5b. Ativa avaliação de métricas e alertas periódicos (Roadmap #6 - Observabilidade)
            const alertService = require('./services/AlertService');
            const monitoringService = require('./services/MonitoringService');
            setInterval(async () => {
                try {
                    const health = await monitoringService.health();
                    const metrics = {
                        dbHealth: health.database?.ok ?? false,
                        cacheHealth: health.cache?.ok ?? false,
                        memoryUsage: process.memoryUsage().heapUsed / process.memoryUsage().heapTotal,
                        errorRate: health.metrics.requests > 0 ? (health.metrics.errors / health.metrics.requests) : 0,
                        responseTime: health.metrics.avgResponseTime || 0,
                    };
                    await alertService.evaluateMetrics(metrics);
                } catch (err) {
                    logger.error('Erro ao avaliar métricas de alerta:', err);
                }
            }, 60000);

            // 6. Ativa resumo diário às 16h (BRT)
            const { iniciarDailyDigest } = require('./jobs/DailyDigestJob');
            iniciarDailyDigest();

            // 7. Cron: Rotação automática do Código Secreto à meia-noite (horário de Brasília)
            cron.schedule('0 0 * * *', async () => {
                try {
                    logger.info('🔐 [CRON] Rotação automática do código secreto (meia-noite BR)');
                    let config = await SecurityConfig.findOne({ chave: 'CONFIG_GERAL' });
                    if (!config) {
                        config = await SecurityConfig.create({
                            codigoSecretoEscola: SecurityController.generateCode(),
                            dataUltimaRotacao: new Date(),
                            rotacaoAutomatica: true
                        });
                    } else {
                        await SecurityController.rotateCodeInternal(config, 'CRON (Meia-Noite-BR)');
                    }
                    logger.info('✅ [CRON] Código secreto atualizado com sucesso');
                } catch (err) {
                    logger.error('❌ [CRON] Erro na rotação do código', { error: err.message });
                }
            }, { timezone: 'America/Sao_Paulo' });
            logger.info('🔐 [SECURITY] Cron de rotação do código secreto ativo', { schedule: '00:00 BRT' });
        });

        // Configuração do Socket.IO com autenticação JWT
        const { Server } = require('socket.io');
        const jwt = require('jsonwebtoken');
        const JWT_SECRET = require('./utils/jwtConfig');

        const io = new Server(server, {
            cors: {
                origin: process.env.NODE_ENV === 'production'
                    ? [process.env.FRONTEND_URL, 'https://sistema-escolar-bfty.onrender.com']
                    : '*',
                methods: ['GET', 'POST'],
                credentials: true
            },
            pingTimeout: 60000,
            pingInterval: 25000
        });

        // Middleware de autenticação Socket.IO
        io.use((socket, next) => {
            try {
                // Tenta obter token do handshake (cookie ou query)
                const token = socket.handshake.auth?.token 
                    || socket.handshake.headers?.cookie?.match(/escola_jwt=([^;]+)/)?.[1]
                    || socket.handshake.query?.token;

                if (!token) {
                    return next(new Error('Authentication required'));
                }

                const decoded = jwt.verify(token, JWT_SECRET);
                socket.user = decoded;
                next();
            } catch (err) {
                next(new Error('Invalid authentication token'));
            }
        });

        io.on('connection', (socket) => {
            const user = socket.user;
            // Entra na sala do usuário individual
            socket.join(`user:${user.id || user._id}`);
            // Entra na sala do perfil (professor, diretor, admin, responsavel)
            socket.join(`role:${user.perfil}`);
            logger.debug(`🔌 [Socket.IO] ${user.nome || 'Usuário'} conectado`, { perfil: user.perfil, room: `user:${user.id || user._id}` });

            // Evento: usuário quer entrar em sala de mensagem específica
            socket.on('join:message', (messageId) => {
                if (!socket.user) {
                    return;
                }
                socket.join(`message:${messageId}`);
            });

            socket.on('disconnect', () => {
                logger.debug(`❌ [Socket.IO] ${user.nome || 'Usuário'} desconectado`);
            });
        });

        global.io = io;

        // Tratamento de Rejeições Não Tratadas (Promises)
        process.on('unhandledRejection', (err, promise) => {
            logger.alert('UNHANDLED_REJECTION', err?.message || 'Rejeição não tratada', {
                stack: err?.stack,
            });
            server.close(() => process.exit(1));
        });

        // Tratamento de Exceções Não Capturadas (Síncrono)
        process.on('uncaughtException', (err) => {
            logger.alert('UNCAUGHT_EXCEPTION', err.message, {
                stack: err.stack,
            });
            server.close(() => process.exit(1));
        });

    } catch (err) {
        logger.fatal(`❌ Erro fatal ao iniciar o servidor: ${err.message}`, { stack: err.stack });
        process.exit(1);
    }
};

/**
 * Migração silenciosa de preferências de voz/TTS/acessibilidade.
 * Roda em background no boot — não bloqueia o servidor.
 * Apenas preenche campos ausentes com defaults; nunca sobrescreve dados existentes.
 */
async function _runVoiceMigrationSilent() {
    const mongoose = require('mongoose');
    const db = mongoose.connection.db;
    if (!db) return;

    const col = db.collection('usuarios');

    const DEFAULTS = {
        voiceGender:              'male',
        voiceSpeed:               1.0,
        ttsProvider:              'google-cloud',
        preferenciaNarracao:      'texto_audio',
        accessibilityFontSize:    '100%',
        accessibilityContrast:    false,
        accessibilityReadingMode: false
    };

    let total = 0;
    for (const [field, value] of Object.entries(DEFAULTS)) {
        const result = await col.updateMany(
            { [field]: { $exists: false } },
            { $set: { [field]: value } }
        );
        if (result.modifiedCount > 0) {
            logger.info(`[VoiceMigration] '${field}': ${result.modifiedCount} usuário(s) atualizados com default '${value}'`);
            total += result.modifiedCount;
        }
    }

    // Garante TTL index no cache de áudio
    try {
        const cacheCol = db.collection('ttsaudiocaches');
        await cacheCol.createIndex(
            { expiraEm: 1 },
            { expireAfterSeconds: 0, name: 'ttl_expiraEm', background: true }
        );
        // Preenche campo expiraEm em registros antigos sem TTL
        const trintaDias = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
        await cacheCol.updateMany(
            { expiraEm: { $exists: false } },
            { $set: { expiraEm: trintaDias } }
        );
    } catch (_) { /* índice já existe ou coleção vazia — ok */ }

    if (total > 0) {
        logger.info(`[VoiceMigration] Concluída — ${total} campo(s) preenchidos no total.`);
    }
}

startServer();
