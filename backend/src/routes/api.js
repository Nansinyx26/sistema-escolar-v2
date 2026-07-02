const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const crypto = require('crypto');

// Middlewares Globais
const authJWT = require('../middleware/authJWT');
const horizontalFilter = require('../middleware/horizontalFilter');
const authorize = require('../middleware/authorize');
const upload = require('../middleware/upload');
const uploadDocument = require('../middleware/uploadDocument');
const { convertToWebP } = require('../middleware/upload');

// Controllers Auxiliares (mantidos para rotas gerais da raiz)
const ConfigController = require('../controllers/ConfigController');
const FileController = require('../controllers/FileController');
const { runHealthCheck } = require('../utils/healthMonitor');
const monitoring = require('../services/MonitoringService');

// --- 1. Diagnóstico / Health Check (Públicos) ---
router.get('/health', (req, res) => {
    const health = runHealthCheck();
    const statusCode = health.db.healthy ? 200 : 503;
    res.status(statusCode).json({
        success: health.db.healthy,
        status: health.db.healthy ? 'ok' : 'degraded',
        timestamp: health.timestamp,
        uptime: health.uptime.formatted,
        database: health.db.stateName,
        memory: {
            heapUsedMB: health.memory.heapUsedMB,
            rssMB: health.memory.rssMB,
        },
    });
});
router.get('/monitoring/health', async (req, res) => {
    const health = await monitoring.health();
    res.status(health.ok ? 200 : 503).json(health);
});
router.get('/metrics', (req, res) => {
    res.type('text/plain');
    res.send(monitoring.getPrometheusMetrics());
});
router.get('/ping', (req, res) => res.json({ success: true, message: 'API is working' }));

// --- 2. Configurações Globais ---
router.get('/config', ConfigController.get);
router.put('/config/:id', authJWT, authorize('admin'), ConfigController.update);

// --- 3. Uploads de Fotos ---
router.get('/files/:id', FileController.serveFile); // Rota pública principal (usada pelo getPhotoUrl)
router.get('/public/photo/:id', FileController.serveFile); // Rota pública legada
router.get('/upload/photo/:id', authJWT, FileController.serveFile);
router.post('/upload/photo', authJWT, upload.single('foto'), convertToWebP, async (req, res) => {
    if (!req.file) return res.status(400).json({ success: false, error: 'Nenhum arquivo enviado' });
    try {
        const db = mongoose.connection.db;
        const bucket = new mongoose.mongo.GridFSBucket(db, { bucketName: 'uploads' });
        const filename = crypto.randomBytes(16).toString('hex') + '.webp';
        const uploadStream = bucket.openUploadStream(filename, { contentType: 'image/webp' });
        uploadStream.end(req.file.buffer);
        uploadStream.on('finish', () => {
            res.json({ success: true, data: { id: uploadStream.id, filename: filename } });
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// --- 3b. Upload de Documentos (PDF, JPG, PNG) ---
router.get('/upload/documento/:id', authJWT, FileController.serveFile);
router.post('/upload/documento', authJWT, uploadDocument.array('documentos', 10), async (req, res) => {
    if (!req.files || req.files.length === 0) {
        return res.status(400).json({ success: false, error: 'Nenhum arquivo enviado' });
    }
    try {
        const db = mongoose.connection.db;
        const bucket = new mongoose.mongo.GridFSBucket(db, { bucketName: 'uploads' });
        const results = [];

        for (const file of req.files) {
            const ext = file.mimetype === 'application/pdf' ? '.pdf'
                : file.mimetype.includes('png') ? '.png' : '.jpg';
            const filename = crypto.randomBytes(16).toString('hex') + ext;

            const uploadStream = bucket.openUploadStream(filename, { contentType: file.mimetype });
            await new Promise((resolve, reject) => {
                uploadStream.end(file.buffer);
                uploadStream.on('finish', resolve);
                uploadStream.on('error', reject);
            });

            results.push({
                id: uploadStream.id.toString(),
                gridfsId: uploadStream.id.toString(),
                nome: file.originalname,
                tipo: file.mimetype,
                enviadoEm: new Date().toISOString()
            });
        }

        res.json({ success: true, data: results });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// --- 4. Sub-Rotas Modularizadas ---
router.use('/auth', require('./auth'));
router.use('/responsavel', authJWT, require('./responsavel'));
router.use('/notificacoes', authJWT, require('./notificacoes'));
router.use('/security', authJWT, require('./security'));
router.use('/audit', authJWT, require('./audit'));
router.use('/usuarios', authJWT, require('./usuarios'));
router.use('/meus-dados', authJWT, require('./meus-dados'));
router.use('/atribuicoes', authJWT, require('./atribuicoes'));
router.use('/alunos', authJWT, horizontalFilter, require('./alunos'));
router.use('/professores', authJWT, horizontalFilter, require('./professores'));
router.use('/diretores', authJWT, require('./diretores'));
router.use('/turmas', authJWT, horizontalFilter, require('./turmas'));
router.use('/faltas', authJWT, horizontalFilter, require('./faltas'));
router.use('/frequencia-professores', authJWT, horizontalFilter, require('./frequencia-professores'));
router.use('/notas', authJWT, horizontalFilter, require('./notas'));
router.use('/dashboard', require('./dashboard'));
router.use('/tabela-geral', authJWT, require('./tabela-geral'));
router.use('/grade-horaria', authJWT, require('./grade-horaria'));
router.use('/avaliacoes', require('./avaliacoes'));
router.use('/reviews', authJWT, require('./reviews'));
router.use('/reactions', authJWT, require('./reactions'));
router.use('/notifications/realtime', authJWT, require('./realtime-notifications'));
router.use('/comunicados', authJWT, require('./comunicados'));
router.use('/comentarios', authJWT, require('./comentarios'));
router.use('/relatorios', authJWT, require('./relatorios'));
router.use('/audio', require('./audio'));
router.use('/tts', authJWT, require('./tts'));
router.use('/ia', authJWT, require('./ia'));
router.use('/chatbot', authJWT, require('./chatbot'));
router.use('/secretaria', authJWT, require('./secretaria'));

// --- 5. Gamificação ---
const GamificacaoController = require('../controllers/GamificacaoController');
router.get('/gamificacao/aluno/:alunoId', authJWT, GamificacaoController.getBadgesAluno);
router.post('/gamificacao/recalcular/:alunoId', authJWT, GamificacaoController.recalcularBadges);

// --- 6. Chat Direto ---
const ChatDiretoController = require('../controllers/ChatDiretoController');
router.post('/chat-direto/enviar', authJWT, ChatDiretoController.enviarMensagem);
router.get('/chat-direto/historico/:outroUsuarioId', authJWT, ChatDiretoController.getHistorico);
router.patch('/chat-direto/lida/:mensagemId', authJWT, ChatDiretoController.marcarComoLida);

module.exports = router;
