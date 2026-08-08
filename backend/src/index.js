// Config central: carrega .env e valida variáveis obrigatórias.
// Se faltar MONGODB_URI/JWT_SECRET (ou SESSION_SECRET em produção),
// loga quais faltam e encerra ANTES de qualquer conexão.
const { validarAmbiente } = require('./config/env');
validarAmbiente();

// Redireciona `console.*` legado para o logger estruturado ANTES de qualquer
// outro require: a partir daqui nenhuma linha de log escapa da sanitização,
// mesmo nos arquivos ainda não migrados. Desligável com CONSOLE_GUARD=false.
if (process.env.CONSOLE_GUARD !== 'false') {
    require('./utils/consoleGuard').instalar();
}

// NOTA: o patch global do nodemailer (utils/nodemailerPatch.js) foi DESLIGADO.
//
// Ele reescrevia `nodemailer.createTransport` no processo inteiro para desviar
// o envio à API HTTP do Brevo — a solução certa para o bloqueio de SMTP do
// Render, mas condicionada a `EMAIL_HOST.includes('brevo')`. Com a produção
// configurada em Resend, a condição nunca era verdadeira e todo envio caía no
// SMTP bloqueado, em silêncio.
//
// services/EnvioEmail.js faz o mesmo desvio de forma explícita, para Resend E
// Brevo, escolhendo o transporte pelo formato da própria chave. Manter os dois
// significaria dois caminhos de envio disputando o mesmo `sendMail`.
//
// O arquivo continua no repositório para consulta; reative-o apenas se voltar a
// depender de um `createTransport` direto em algum ponto.

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

        // Retenção das conversas do assistente: o TTL fica gravado dentro do
        // índice, então mudar IA_RETENCAO_DIAS não teria efeito sem este
        // alinhamento — a política de exclusão ficaria congelada em silêncio.
        try {
            const { sincronizarRetencao } = require('./models/IaConversa');
            const r = await sincronizarRetencao();
            if (r.acao === 'atualizado') {
                logger.info(`[Boot] Retenção das conversas do assistente: ${r.de}s → ${r.para}s.`);
            } else if (r.acao === 'criado') {
                logger.info(`[Boot] Índice de retenção das conversas criado (${r.para}s).`);
            }
        } catch (err) {
            logger.error('[Boot] Falha ao alinhar a retenção das conversas do assistente', { err });
        }

        // 2. Iniciar Servidor somente se o banco estiver OK
        const server = app.listen(PORT, () => {
            logger.info(`✅ Servidor iniciado`, { mode: process.env.NODE_ENV, port: PORT });

            // 3. Ativa keep-alive para prevenir cold start no Render Free
            startKeepAlive();
            // 4. Ativa cron de anonimização automática (LGPD)
            startAnonimizacaoAutomatica();
            // 5. Ativa health monitor periódico (Roadmap #6)
            startHealthMonitor();

            // 5a-. Dispensa de 2FA ativa? O boot grita.
            //
            // Uma configuracao que enfraquece autenticacao nao pode ficar
            // silenciosa: e o tipo de coisa que se liga "so por hoje" e fica
            // ligada por meses porque nada nunca lembra ninguem dela.
            const avisoPolitica2FA = require('./utils/politica2FA').avisoDeBoot();
            if (avisoPolitica2FA) {
                logger.alert('SEGURANCA_2FA_DISPENSADO', avisoPolitica2FA, { action: 'boot.politica2FA' });
                logger.warn(`⚠️  ${avisoPolitica2FA}`);
            }

            // 5a. Verifica o canal de e-mail e DIZ o resultado no log.
            //
            // O 2FA de diretor e secretaria depende inteiramente deste canal.
            // Antes não havia verificação nenhuma: uma configuração quebrada só
            // aparecia quando alguém não conseguia entrar, sem erro visível em
            // lugar algum. Agora o boot é o momento em que isso fica evidente.
            //
            // Não derruba o processo: o resto do sistema funciona sem e-mail, e
            // um servidor no ar com aviso é melhor que um servidor fora do ar.
            require('./services/EnvioEmail').verificarEnvio()
                .then((r) => {
                    if (r.ok) {
                        logger.info('✅ Canal de e-mail operacional', {
                            transporte: r.transporte, remetente: r.remetente, action: 'boot.email',
                        });
                    } else {
                        logger.alert('EMAIL_INDISPONIVEL',
                            `Canal de e-mail NÃO operacional (${r.etapa}): ${r.erro}`,
                            { transporte: r.transporte, action: 'boot.email' });
                        logger.error('⚠️  E-mail indisponível — 2FA de diretor e secretaria vai falhar. ' +
                            'Rode GET /api/admin/diag/email para o detalhe.', { etapa: r.etapa, erro: r.erro });
                    }
                })
                .catch((err) => logger.error('[Boot] Falha ao verificar o canal de e-mail', { err }));

            // 5b. Ativa avaliação de métricas e alertas periódicos (Roadmap #6 - Observabilidade)
            const alertService = require('./services/AlertService');
            const monitoringService = require('./services/MonitoringService');
            setInterval(async () => {
                try {
                    const health = await monitoringService.health();
                    const metrics = {
                        dbHealth: health.database?.ok ?? false,
                        cacheHealth: health.cache?.ok ?? false,
                        memoryUsage: monitoringService.getMemoryUsageRatio(),
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

            // 6b. Ativa aviso automático de atualizações do sistema às 16h (BRT)
            const { iniciarSystemUpdateJob } = require('./jobs/SystemUpdateJob');
            iniciarSystemUpdateJob();

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

        // Adapter compartilhado. Com uma instância só (plano free do Render) ele
        // fica desligado; a partir de duas, sem isto as salas ficam presas ao
        // processo e mensagem/presença não cruzam entre instâncias.
        const { instalarAdapter } = require('./realtime/adapter');
        await instalarAdapter(io);

        // Middleware de autenticação Socket.IO
        // Replica as MESMAS checagens do authJWT: só verificar a assinatura
        // deixava um token de conta desativada (ou com senha trocada) recebendo
        // eventos em tempo real por até 8h depois da revogação.
        const Usuario = require('./models/Usuario');
        const { vinculosDoUsuario } = require('./middleware/filtrarPorEscola');

        io.use(async (socket, next) => {
            try {
                // Tenta obter token do handshake (cookie ou query)
                const token = socket.handshake.auth?.token
                    || socket.handshake.headers?.cookie?.match(/escola_jwt=([^;]+)/)?.[1]
                    || socket.handshake.query?.token;

                if (!token) {
                    return next(new Error('Authentication required'));
                }

                const decoded = jwt.verify(token, JWT_SECRET);

                const conta = await Usuario.findById(decoded.id || decoded._id)
                    .select('tokenVersion ativo perfil escolaId')
                    .lean();

                if (!conta || conta.ativo === false) {
                    return next(new Error('Account disabled'));
                }

                const versaoConta = conta.tokenVersion !== undefined ? conta.tokenVersion : 0;
                const versaoToken = decoded.tokenVersion !== undefined ? decoded.tokenVersion : 0;
                if (versaoConta !== versaoToken) {
                    return next(new Error('Session revoked'));
                }

                // Perfil vem do BANCO, não do token: um rebaixamento vale na hora
                socket.user = { ...decoded, perfil: conta.perfil };

                // Escola do socket — base do isolamento multi-tenant no realtime
                let escolaId = conta.escolaId ? String(conta.escolaId) : null;
                if (!escolaId) {
                    const vinculos = await vinculosDoUsuario({
                        id: conta._id, email: decoded.email, perfil: conta.perfil
                    });
                    if (vinculos.length === 1) escolaId = String(vinculos[0].escolaId);
                }
                socket.escolaId = escolaId;

                next();
            } catch (err) {
                next(new Error('Invalid authentication token'));
            }
        });

        const presence = require('./realtime/presence');
        io.on('connection', (socket) => {
            const user = socket.user;
            const uid = user.id || user._id;
            // Entra na sala do usuário individual
            socket.join(`user:${uid}`);
            // Entra na sala do perfil (professor, diretor, admin, responsavel)
            socket.join(`role:${user.perfil}`);
            // Entra na sala da escola — os emissores usam a interseção
            // escola × perfil para não vazar eventos entre tenants
            if (socket.escolaId) socket.join(`escola:${socket.escolaId}`);

            // Presença online: a equipe (professores e diretores) é notificada em tempo real.
            if (socket.escolaId) {
                const ficouOnline = presence.addUser(socket.escolaId, uid, socket.id);
                if (ficouOnline) {
                    io.to(`escola:${socket.escolaId}`).emit('presence:professor', {
                        userId: String(uid), online: true,
                        status: presence.statusDe(socket.escolaId, uid),
                        perfil: user.perfil
                    });
                }
            }

            logger.debug(`🔌 [Socket.IO] ${user.nome || 'Usuário'} conectado`, {
                perfil: user.perfil,
                room: `user:${user.id || user._id}`,
                escola: socket.escolaId || 'n/d'
            });

            // Eventos de digitação e gravação de áudio em tempo real.
            // O destinatário sai do próprio mapa de presença da escola: assim
            // um socket não consegue disparar "digitando" para usuários de
            // outro tenant só informando um id arbitrário.
            const mesmoTenant = (destinatarioId) => (
                !!socket.escolaId && presence.isOnline(socket.escolaId, destinatarioId)
            );

            socket.on('chat:typing', (data) => {
                if (!data || !data.destinatarioId) return;
                if (!mesmoTenant(data.destinatarioId)) return;
                io.to(`user:${data.destinatarioId}`).emit('chat:typing', {
                    remetenteId: String(uid),
                    isTyping: !!data.isTyping
                });
            });

            socket.on('chat:recording', (data) => {
                if (!data || !data.destinatarioId) return;
                if (!mesmoTenant(data.destinatarioId)) return;
                io.to(`user:${data.destinatarioId}`).emit('chat:recording', {
                    remetenteId: String(uid),
                    isRecording: !!data.isRecording
                });
            });

            // Status 🟡 Ausente: a aba avisa quando o usuário fica ocioso
            // (sem foco/interação) e quando volta. Só vira "ausente" quando
            // TODAS as abas dele estão ociosas — ver realtime/presence.js.
            socket.on('presence:idle', (data) => {
                if (!socket.escolaId) return;
                const ausente = !!(data && data.ausente);
                const mudou = presence.setAusente(socket.escolaId, uid, socket.id, ausente);
                if (mudou) {
                    io.to(`escola:${socket.escolaId}`).emit('presence:professor', {
                        userId: String(uid), online: true,
                        status: presence.statusDe(socket.escolaId, uid),
                        perfil: user.perfil
                    });
                }
            });

            // Evento: usuário quer entrar em sala de mensagem específica.
            socket.on('join:message', async (messageId) => {
                if (!socket.user || !messageId) return;
                try {
                    const permitido = await podeAcessarMensagem(socket, String(messageId));
                    if (!permitido) {
                        logger.debug('[Socket.IO] join:message negado', { messageId });
                        return;
                    }
                    socket.join(`message:${messageId}`);
                } catch (e) {
                    logger.warn(`[Socket.IO] Falha ao validar join:message: ${e.message}`);
                }
            });

            socket.on('disconnect', () => {
                logger.debug(`❌ [Socket.IO] ${user.nome || 'Usuário'} desconectado`);
                if (socket.escolaId) {
                    const ficouOffline = presence.removeUser(socket.escolaId, uid, socket.id);
                    if (ficouOffline) {
                        io.to(`escola:${socket.escolaId}`).emit('presence:professor', {
                            userId: String(uid), online: false, status: 'offline',
                            perfil: user.perfil
                        });
                    }
                }
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
 * Autoriza a entrada numa sala `message:<id>`.
 *
 * A sala carrega comentários e reações (nome e perfil de quem reagiu) de um
 * comunicado ou de uma notificação. O usuário só entra se o documento
 * pertencer à sua escola e for endereçado a ele.
 */
async function podeAcessarMensagem(socket, messageId) {
    const perfil = String(socket.user?.perfil || '').toLowerCase();
    if (perfil === 'admin') return true;

    const mongoose = require('mongoose');
    const Comunicado = require('./models/Comunicado');
    const Notificacao = require('./models/Notificacao');

    const filtroId = mongoose.Types.ObjectId.isValid(messageId)
        ? { $or: [{ _id: messageId }, { id: messageId }] }
        : { id: messageId };

    const doc = await Comunicado.findOne(filtroId).select('escolaId destinatarios').lean()
        || await Notificacao.findOne(filtroId).select('escolaId destinatarios paraResponsavel').lean();

    if (!doc) return false;

    // Fronteira de escola
    if (socket.escolaId && doc.escolaId && String(doc.escolaId) !== String(socket.escolaId)) {
        return false;
    }

    // Gestão acompanha qualquer mensagem da própria escola
    if (['diretor', 'secretaria'].includes(perfil)) return true;

    // Responsável nunca entra em sala de aviso interno de funcionários
    if (perfil === 'responsavel' && doc.paraResponsavel === false) return false;

    const destinatarios = Array.isArray(doc.destinatarios)
        ? doc.destinatarios
        : [doc.destinatarios].filter(Boolean);

    const alvos = ['todos', `usuario:${socket.user.id || socket.user._id}`];
    if (perfil === 'professor') alvos.push('professores');

    if (perfil === 'responsavel' && socket.user.email) {
        alvos.push('responsaveis');
        // Avisos endereçados à turma ou diretamente ao aluno vinculado
        const Aluno = require('./models/Aluno');
        const escapeRegex = require('./utils/escapeRegex');
        const emailRegex = new RegExp(`^${escapeRegex(String(socket.user.email))}$`, 'i');
        const alunos = await Aluno.find({
            $or: [
                { responsavel: emailRegex },
                { 'responsavelDados.email': emailRegex },
                { 'responsaveis.email': emailRegex }
            ]
        }).select('turma turmaId id').lean();

        alunos.forEach(a => {
            const t = a.turma || a.turmaId;
            if (t) alvos.push(t, `turma:${t}`);
            alvos.push(String(a._id));
            if (a.id) alvos.push(String(a.id));
        });
    }

    return destinatarios.some(d => alvos.includes(String(d)));
}

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
    } catch (e) {
        // Caso normal: índice já existe ou coleção vazia. Fica em debug para não
        // poluir o boot, mas deixa de ser invisível quando a migração falha.
        logger.debug('[VoiceMigration] Passo de TTL/índice ignorado', {
            err: e, action: 'migracao.voice',
        });
    }

    if (total > 0) {
        logger.info(`[VoiceMigration] Concluída — ${total} campo(s) preenchidos no total.`);
    }
}

startServer();
