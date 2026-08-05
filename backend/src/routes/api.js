const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const crypto = require('crypto');

// Middlewares Globais
const authJWT = require('../middleware/authJWT');
const horizontalFilter = require('../middleware/horizontalFilter');
const filtrarPorEscola = require('../middleware/filtrarPorEscola');
const authorize = require('../middleware/authorize');
const upload = require('../middleware/upload');
const uploadDocument = require('../middleware/uploadDocument');
const { convertToWebP } = require('../middleware/upload');
// Confere os BYTES do arquivo contra o mimetype declarado. Usado tanto aqui
// (documentos de aluno) quanto nos anexos do chat, mais abaixo.
const { validarAssinatura } = require('../utils/assinaturaArquivo');

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
    // Em produção, exige token (METRICS_TOKEN) — métricas internas não são públicas
    if (process.env.NODE_ENV === 'production') {
        const expected = process.env.METRICS_TOKEN;
        const provided = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
        if (!expected || provided !== expected) {
            return res.status(404).json({ success: false, error: 'Endpoint não encontrado' });
        }
    }
    res.type('text/plain');
    res.send(monitoring.getPrometheusMetrics());
});
router.get('/ping', (req, res) => res.json({ success: true, message: 'API is working' }));

// --- 2. Configurações Globais ---
router.get('/config', ConfigController.get);
router.put('/config/:id', authJWT, authorize('admin'), ConfigController.update);

// --- 3. Uploads de Fotos ---
// Rotas públicas servem SOMENTE imagens; documentos (PDF etc.) exigem authJWT.
router.get('/files/:id', FileController.servePublicImage); // Rota pública principal (usada pelo getPhotoUrl)
router.get('/public/photo/:id', FileController.servePublicImage); // Rota pública legada
router.get('/upload/photo/:id', authJWT, filtrarPorEscola, FileController.serveFile);
router.post('/upload/photo', authJWT, filtrarPorEscola, upload.single('foto'), convertToWebP, async (req, res) => {
    if (!req.file) return res.status(400).json({ success: false, error: 'Nenhum arquivo enviado' });
    try {
        const db = mongoose.connection.db;
        const bucket = new mongoose.mongo.GridFSBucket(db, { bucketName: 'uploads' });
        const filename = crypto.randomBytes(16).toString('hex') + '.webp';
        const uploadStream = bucket.openUploadStream(filename, {
            contentType: 'image/webp',
            // Metadata é o que permite ao FileController decidir quem pode baixar
            metadata: {
                usuarioId: String(req.user?.id || req.user?._id || ''),
                escolaId: req.escolaId ? String(req.escolaId) : undefined,
                alunoId: req.body?.alunoId ? String(req.body.alunoId) : undefined
            }
        });
        uploadStream.end(req.file.buffer);
        uploadStream.on('finish', () => {
            res.json({ success: true, data: { id: uploadStream.id, filename: filename } });
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// --- 3b. Upload de Documentos (PDF, JPG, PNG) ---
router.get('/upload/documento/:id', authJWT, horizontalFilter, filtrarPorEscola, FileController.serveFile);
router.post('/upload/documento', authJWT, horizontalFilter, filtrarPorEscola, uploadDocument.array('documentos', 10), async (req, res) => {
    if (!req.files || req.files.length === 0) {
        return res.status(400).json({ success: false, error: 'Nenhum arquivo enviado' });
    }

    // O `fileFilter` do uploadDocument só olha `file.mimetype`, que é o
    // Content-Type que o CLIENTE mandou. O anexo do chat já era conferido byte a
    // byte; aqui não era — e este é o caminho que grava RG/CPF/comprovante de
    // criança. Um `payload.exe` renomeado para `rg.pdf` entrava no GridFS e
    // depois era baixado pela secretaria como se fosse o documento.
    //
    // Diferente de /api/upload/photo, aqui não há reencode (o sharp do WebP é o
    // que barra o disfarce naquela rota): o byte enviado é o byte guardado.
    for (const arquivo of req.files) {
        const veredito = validarAssinatura(arquivo.buffer, arquivo.mimetype);
        if (!veredito.ok) {
            return res.status(400).json({
                success: false,
                error: `"${arquivo.originalname}": ${veredito.motivo}`
            });
        }
    }

    try {
        // O documento é vinculado a um aluno já no upload — é esse metadata
        // que o FileController usa depois para decidir quem pode baixá-lo.
        // Sem alunoId, o arquivo fica restrito a quem o enviou + gestão.
        let alunoId;
        if (req.body?.alunoId) {
            const { assertAcessoAoAluno } = require('../middleware/assertAcessoAoAluno');
            const acesso = await assertAcessoAoAluno(req, String(req.body.alunoId));
            if (!acesso.ok) {
                return res.status(acesso.status).json({ success: false, error: acesso.error });
            }
            alunoId = String(req.body.alunoId);
        }

        const db = mongoose.connection.db;
        const bucket = new mongoose.mongo.GridFSBucket(db, { bucketName: 'uploads' });
        const results = [];

        for (const file of req.files) {
            const ext = file.mimetype === 'application/pdf' ? '.pdf'
                : file.mimetype.includes('png') ? '.png' : '.jpg';
            const filename = crypto.randomBytes(16).toString('hex') + ext;

            const uploadStream = bucket.openUploadStream(filename, {
                contentType: file.mimetype,
                metadata: {
                    usuarioId: String(req.user?.id || req.user?._id || ''),
                    escolaId: req.escolaId ? String(req.escolaId) : undefined,
                    alunoId
                }
            });
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
router.use('/escolas', require('./escolas')); // GET público (modal) + troca de escola (auth interna)
router.use('/responsavel', authJWT, require('./responsavel'));
router.use('/notificacoes', authJWT, filtrarPorEscola, require('./notificacoes'));
// `filtrarPorEscola`: é o req.escolaId que faz o SecurityController escopar o
// código de cadastro à escola do diretor em vez do código global da rede.
router.use('/security', authJWT, filtrarPorEscola, require('./security'));
router.use('/audit', authJWT, filtrarPorEscola, require('./audit'));
router.use('/usuarios', authJWT, filtrarPorEscola, require('./usuarios'));
router.use('/meus-dados', authJWT, require('./meus-dados'));
router.use('/atribuicoes', authJWT, require('./atribuicoes'));
router.use('/alunos', authJWT, horizontalFilter, filtrarPorEscola, require('./alunos'));
router.use('/professores', authJWT, horizontalFilter, filtrarPorEscola, require('./professores'));
// `filtrarPorEscola` é o que resolve req.escolaId — sem ele o escopo de escola
// do DirectorController vira no-op e a listagem volta a varrer a rede inteira.
router.use('/diretores', authJWT, filtrarPorEscola, require('./diretores'));
router.use('/turmas', authJWT, horizontalFilter, filtrarPorEscola, require('./turmas'));
router.use('/faltas', authJWT, horizontalFilter, filtrarPorEscola, require('./faltas'));
router.use('/frequencia-professores', authJWT, horizontalFilter, require('./frequencia-professores'));
// Planilha de faltas dos funcionários — `filtrarPorEscola` é obrigatório: é ele
// que resolve req.escolaId, usado tanto para listar o quadro quanto para isolar
// a planilha por escola.
router.use('/faltas-funcionarios', authJWT, filtrarPorEscola, require('./faltas-funcionarios'));
router.use('/notas', authJWT, horizontalFilter, filtrarPorEscola, require('./notas'));
router.use('/dashboard', require('./dashboard'));
router.use('/tabela-geral', authJWT, require('./tabela-geral'));
router.use('/grade-horaria', authJWT, require('./grade-horaria'));
router.use('/avaliacoes', require('./avaliacoes'));
router.use('/reviews', authJWT, require('./reviews'));
router.use('/reactions', authJWT, require('./reactions'));
router.use('/notifications/realtime', authJWT, require('./realtime-notifications'));
router.use('/comunicados', authJWT, filtrarPorEscola, require('./comunicados'));
// `filtrarPorEscola` aqui pelo mesmo motivo de /comunicados: sem req.escolaId
// o escopo de tenant do guard de thread (assertAcessoAThread) vira no-op.
router.use('/comentarios', authJWT, filtrarPorEscola, require('./comentarios'));
router.use('/relatorios', authJWT, horizontalFilter, filtrarPorEscola, require('./relatorios'));
router.use('/audio', require('./audio'));
router.use('/tts', authJWT, require('./tts'));
router.use('/ia', authJWT, horizontalFilter, filtrarPorEscola, require('./ia'));
router.use('/chatbot', authJWT, require('./chatbot'));
router.use('/secretaria', authJWT, require('./secretaria'));

// --- 5. Gamificação ---
// Mesmo padrão :alunoId das rotas de IA/notas — passa pelo guard de acesso.
const GamificacaoController = require('../controllers/GamificacaoController');
const { requireAcessoAoAluno } = require('../middleware/assertAcessoAoAluno');
router.get('/gamificacao/aluno/:alunoId', authJWT, horizontalFilter, filtrarPorEscola, requireAcessoAoAluno('alunoId'), GamificacaoController.getBadgesAluno);
router.post('/gamificacao/recalcular/:alunoId', authJWT, horizontalFilter, filtrarPorEscola, authorize('admin', 'diretor', 'secretaria', 'professor'), requireAcessoAoAluno('alunoId'), GamificacaoController.recalcularBadges);

// --- 6. Chat Direto ---
// `bloquearPalavroes` fica antes do controller: a conversa direta entre
// responsável e equipe escolar é o canal mais exposto a xingamento, e uma vez
// gravada a mensagem já está entregue.
const ChatDiretoController = require('../controllers/ChatDiretoController');
const bloquearPalavroes = require('../middleware/bloquearPalavroes');
// Teto de envio (30/min por conta, 120/min por IP). Vem DEPOIS do authJWT
// porque a chave é o usuário autenticado, e ANTES do filtro de palavrões e do
// controller para que o flood seja barrado antes de gastar banco.
const { chatMensagemLimiter, chatUploadLimiter, chatIpLimiter } = require('../middleware/rateLimiters');
// `detalhado: false` só aqui e na edição: nos comentários e avaliações o front
// mostra o nível e o termo detectado, e mudar isso quebraria aquelas telas. No
// chat, devolver o termo exato do dicionário só ajuda quem está caçando uma
// grafia que o filtro não pegue.
router.post('/chat-direto/enviar', authJWT, filtrarPorEscola,
    chatIpLimiter, chatMensagemLimiter,
    bloquearPalavroes('mensagem', { recurso: 'chat-direto', detalhado: false }),
    ChatDiretoController.enviarMensagem);
router.get('/chat-direto/historico/:outroUsuarioId', authJWT, ChatDiretoController.getHistorico);
router.patch('/chat-direto/lida/:mensagemId', authJWT, ChatDiretoController.marcarComoLida);
router.patch('/chat-direto/lidas/:outroUsuarioId', authJWT, ChatDiretoController.marcarConversaComoLida);
router.put('/chat-direto/mensagem/:mensagemId', authJWT, bloquearPalavroes('novaMensagem', { recurso: 'chat-direto', detalhado: false }), ChatDiretoController.editarMensagem);
router.delete('/chat-direto/mensagem/:mensagemId', authJWT, ChatDiretoController.apagarMensagem);
router.post('/chat-direto/reagir', authJWT, ChatDiretoController.reagirMensagem);
// Encaminhar cria N mensagens × M destinatários numa requisição só — é o
// caminho mais barato para gerar volume, então entra no mesmo orçamento.
router.post('/chat-direto/encaminhar', authJWT, filtrarPorEscola,
    chatMensagemLimiter, ChatDiretoController.encaminharMensagem);
router.get('/chat-direto/presenca/:outroUsuarioId', authJWT, filtrarPorEscola, ChatDiretoController.getPresenca);

// Anexos/áudios do chat: bucket próprio de mimetypes (Word, Excel, ZIP, vídeo,
// audio/webm) e metadata com os dois lados da conversa — o download reusa o
// `serveFile`, que autoriza remetente e destinatário via FileController.
const uploadChat = require('../middleware/uploadChat');
// Erro do multer (tipo não permitido / arquivo grande) vira 400 legível em vez
// de cair no handler genérico como 500.
const receberAnexosChat = (req, res, next) => {
    uploadChat.array('arquivos', 5)(req, res, (err) => {
        if (err) {
            const grande = err.code === 'LIMIT_FILE_SIZE';
            return res.status(400).json({
                success: false,
                error: grande ? 'Arquivo acima do limite de 10 MB.' : (err.message || 'Falha no upload.')
            });
        }

        // O fileFilter do multer confia no Content-Type que o CLIENTE mandou.
        // Aqui os bytes são conferidos de verdade: um .exe renomeado para .pdf
        // passava pela lista branca e ia parar no GridFS.
        for (const arquivo of req.files || []) {
            // Áudio tem teto próprio (5 MB), menor que o dos demais anexos.
            if (String(arquivo.mimetype).startsWith('audio/') && arquivo.size > uploadChat.LIMITE_AUDIO) {
                return res.status(400).json({
                    success: false,
                    error: `"${arquivo.originalname}": áudio acima do limite de 5 MB.`
                });
            }

            const veredito = validarAssinatura(arquivo.buffer, arquivo.mimetype);
            if (!veredito.ok) {
                return res.status(400).json({
                    success: false,
                    error: `"${arquivo.originalname}": ${veredito.motivo}`
                });
            }
        }

        return next();
    });
};
router.post('/chat-direto/upload', authJWT, filtrarPorEscola,
    chatUploadLimiter, receberAnexosChat, ChatDiretoController.uploadAnexo);
router.get('/chat-direto/anexo/:id', authJWT, filtrarPorEscola, FileController.serveFile);

module.exports = router;
