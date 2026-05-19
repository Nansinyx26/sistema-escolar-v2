const express = require('express');
const router = express.Router();
const upload = require('../middleware/upload');
const mongoose = require('mongoose');
const authJWT = require('../middleware/authJWT');
const horizontalFilter = require('../middleware/horizontalFilter');
const authorize = require('../middleware/authorize');

// Aplica o filtro horizontal globalmente para rotas autenticadas
router.use(['/alunos', '/professores', '/turmas', '/frequencia', '/notas'], authJWT, horizontalFilter);

// Controllers
const StudentController = require('../controllers/StudentController');
const TeacherController = require('../controllers/TeacherController');
const DirectorController = require('../controllers/DirectorController');
const ClassController = require('../controllers/ClassController');
const AttendanceController = require('../controllers/AttendanceController');
const ReportController = require('../controllers/ReportController');
const SpecialClassController = require('../controllers/SpecialClassController');
const MigrationController = require('../controllers/MigrationController');
const UserController = require('../controllers/UserController');
const NoteController = require('../controllers/NoteController');
const ConfigController = require('../controllers/ConfigController');
const FileController = require('../controllers/FileController');
const TeacherAssignmentController = require('../controllers/TeacherAssignmentController');

const DashboardController = require('../controllers/DashboardController');
const TeacherAttendanceController = require('../controllers/TeacherAttendanceController');
const GradeHorariaController = require('../controllers/GradeHorariaController');
const TabelaGeralController = require('../controllers/TabelaGeralController');
const SecurityController = require('../controllers/SecurityController');
const TwoFactorController = require('../controllers/TwoFactorController'); // MELHORIA: 2FA (Roadmap #1)
const MeusDadosController = require('../controllers/MeusDadosController');  // MELHORIA: Portal LGPD (Roadmap #13)
const AuditLog = require('../models/AuditLog');
const ResponsavelController = require('../controllers/ResponsavelController');
const NotificacaoController = require('../controllers/NotificacaoController');

// Middlewares
const verifyTimetable = require('../middleware/verifyTimetable');
const { checkDuplicateClass, ensureClassRecord } = require('../middleware/logicalGuards');
const { convertToWebP } = require('../middleware/upload');
const crypto = require('crypto');
const escapeRegex = require('../utils/escapeRegex');

// --- Diagnóstico / Health Check ---
// Endpoint público usado pelo keepAlive para manter o servidor ativo no Render Free
router.get('/health', (req, res) => res.json({
    success: true,
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: Math.floor(process.uptime()) + 's'
}));
router.get('/ping', (req, res) => res.json({ success: true, message: 'API is working' }));
router.get('/config', ConfigController.get);
router.put('/config/:id', authJWT, authorize('admin'), ConfigController.update);

// --- Portal do Responsável ---
// Protegido por JWT – o responsável deve estar logado no sistema.
// O email do JWT é usado para localizar o aluno vinculado.
router.get('/responsavel/alunos',              authJWT, ResponsavelController.getAlunos);
router.get('/responsavel/buscar-aluno',        authJWT, ResponsavelController.buscarAluno);
router.post('/responsavel/vincular',           authJWT, ResponsavelController.vincularAluno);
router.get('/responsavel/notas/:alunoId',      authJWT, ResponsavelController.getNotas);
router.get('/responsavel/frequencia/:alunoId', authJWT, ResponsavelController.getFrequencia);
router.get('/responsavel/notificacoes/:alunoId', authJWT, ResponsavelController.getNotificacoes);

// --- Central de Notificações ---
router.get('/notificacoes', authJWT, NotificacaoController.getAll);
router.post('/notificacoes', authJWT, NotificacaoController.create);
router.delete('/notificacoes/:id', authJWT, NotificacaoController.delete);

// --- Autenticação Pública ---
router.post('/auth/login', UserController.login);
router.post('/auth/mock-google-login', UserController.mockGoogleLogin);
router.post('/auth/google-login', UserController.googleLogin);
router.post('/auth/logout', UserController.logout);
router.post('/auth/register-responsavel', UserController.registerResponsavel);
router.post('/auth/forgot-password', UserController.forgotPassword);
router.post('/auth/reset-password', UserController.resetPassword);

// --- Verificar sessão atual (JWT cookie) ---
router.get('/auth/me', authJWT, async (req, res) => {
    try {
        const Usuario = require('../models/Usuario');
        const userId = req.user?.id || req.user?._id;
        if (!userId) return res.status(401).json({ success: false, error: 'Não autenticado' });

        const user = await Usuario.findById(userId).lean();
        if (!user) return res.status(401).json({ success: false, error: 'Usuário não encontrado' });

        // Remove campos sensíveis antes de enviar ao frontend
        const { senha, loginAttempts, __v, ...safeUser } = user;
        if (!safeUser.id) safeUser.id = String(user._id);
        
        res.json({ success: true, user: safeUser });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

router.put('/auth/profile', authJWT, UserController.updateProfile);

// --- 2FA (Autenticação de Dois Fatores) — MELHORIA Roadmap #1 ---
// Enviar código: não requer JWT (usuário acabou de validar senha, ainda sem cookie)
router.post('/auth/2fa/send', TwoFactorController.sendCode);
router.post('/auth/2fa/verify', TwoFactorController.verifyCode);
// Gerenciar 2FA: requer autenticação completa
router.get('/auth/2fa/status', authJWT, TwoFactorController.status);
router.post('/auth/2fa/enable', authJWT, TwoFactorController.enable);
router.post('/auth/2fa/disable', authJWT, TwoFactorController.disable);

// --- Arquivos e Uploads Protegidos ---
router.get('/upload/photo/:id', authJWT, FileController.serveFile);

// OPÇÕES DE CADASTRO (Públicas mas validadas)
router.post('/auth/first-access', UserController.firstAccess);
router.post('/auth/register-code', UserController.registerWithCode);
router.post('/auth/update-password-force', authJWT, UserController.updatePasswordForce);

// Verificação de E-mail (Roadmap #4)
router.get('/auth/verify-email/:token', UserController.verifyEmail);

// --- Segurança da Escola (Restrito: Admin/Diretor) ---
router.get('/security/status', authJWT, authorize('admin', 'diretor'), (req, res) => SecurityController.getStatus(req, res));
router.post('/security/rotate', authJWT, authorize('admin'), (req, res) => SecurityController.forceRotate(req, res));

// --- Auditoria (Restrito: Admin) ---
router.get('/audit/logs', authJWT, authorize('admin'), async (req, res) => {
    try {
        const filters = {};
        if (req.query.usuario) filters.usuarioEmail = new RegExp(escapeRegex(req.query.usuario), 'i'); // SEGURANÇA: Escape regex para prevenir ReDoS
        if (req.query.acao) filters.acao = req.query.acao;
        
        const logs = await AuditLog.find(filters).sort({ data: -1 }).limit(200);
        res.json({ success: true, data: logs });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// --- Usuários (Restrito: Admin) ---
router.get('/usuarios', authJWT, authorize('admin', 'diretor'), UserController.list);
router.post('/usuarios', authJWT, authorize('admin'), UserController.create);
router.put('/usuarios/:id', authJWT, authorize('admin'), UserController.update);
router.delete('/usuarios/:id', authJWT, authorize('admin'), UserController.delete);
router.put('/usuarios/:id/anonymize', authJWT, authorize('admin'), UserController.anonymize);

// --- Portal do Titular LGPD (Roadmap #13) — LGPD Art. 18 ---
// Qualquer usuário autenticado acessa seus próprios dados
router.get('/meus-dados', authJWT, MeusDadosController.exportarMeusDados);
router.post('/meus-dados/solicitar-exclusao', authJWT, MeusDadosController.solicitarExclusao);
router.get('/meus-dados/status-consentimento', authJWT, MeusDadosController.statusConsentimento);

// --- Atribuições ---
router.get('/atribuicoes', authJWT, TeacherAssignmentController.index);
router.post('/atribuicoes/sync', authJWT, authorize('admin', 'diretor'), TeacherAssignmentController.sync);
router.delete('/atribuicoes/:id', authJWT, authorize('admin'), TeacherAssignmentController.delete);

// --- Alunos (Protegidos) ---
router.get('/alunos', authJWT, StudentController.list);
router.get('/alunos/:id', authJWT, StudentController.get);
router.post('/alunos', authJWT, StudentController.create);
router.put('/alunos/:id', authJWT, StudentController.update);
router.delete('/alunos/:id', authJWT, authorize('admin', 'diretor'), StudentController.delete);

// --- Professores (Protegidos) ---
router.get('/professores', authJWT, TeacherController.list);
router.get('/professores/:id', authJWT, TeacherController.get);
router.post('/professores', authJWT, authorize('admin', 'diretor'), TeacherController.create);
router.put('/professores/:id', authJWT, authorize('admin', 'diretor'), TeacherController.update);
router.delete('/professores/:id', authJWT, authorize('admin'), TeacherController.delete);

// --- Diretores (Protegidos) ---
router.get('/diretores', authJWT, authorize('admin'), DirectorController.list);
router.post('/diretores', authJWT, authorize('admin'), DirectorController.create);
router.delete('/diretores/:id', authJWT, authorize('admin'), DirectorController.delete);

// --- Turmas (Protegidas) ---
router.get('/turmas', authJWT, ClassController.list);
router.post('/turmas', authJWT, authorize('admin', 'diretor'), ClassController.create);
router.delete('/turmas/:id', authJWT, authorize('admin'), ClassController.delete);

// --- Faltas (Protegidas) ---
router.get('/faltas', authJWT, AttendanceController.list);
router.post('/faltas', authJWT, verifyTimetable, AttendanceController.create);
router.post('/faltas/sync', authJWT, verifyTimetable, AttendanceController.sync);

// --- Notas (Protegidas) ---
router.get('/notas', authJWT, NoteController.list);
router.post('/notas', authJWT, NoteController.create);
router.get('/notas/media/:alunoId', authJWT, NoteController.getMedia);
router.get('/notas/boletim/:alunoId', authJWT, NoteController.getBoletim);
router.get('/notas/:id', authJWT, NoteController.get);
router.put('/notas/:id', authJWT, NoteController.update);
router.delete('/notas/:id', authJWT, authorize('admin', 'diretor'), NoteController.delete);

// --- Dashboard ---
router.get('/dashboard/summary', authJWT, DashboardController.getSummary);

// --- Tabela Geral (Protegida) ---
router.get('/tabela-geral', authJWT, TabelaGeralController.list);
router.get('/tabela-geral/sala/:turmaId', authJWT, TabelaGeralController.getSala);
router.get('/tabela-geral/prof/:professorKey', authJWT, TabelaGeralController.getProfessor);
router.put('/tabela-geral/celula', authJWT, TabelaGeralController.updateCell);
router.post('/tabela-geral/seed', authJWT, authorize('admin'), TabelaGeralController.seed);
router.delete('/tabela-geral/reset', authJWT, authorize('admin'), TabelaGeralController.reset);

// --- Grade Horária ---
router.post('/grade-horaria', authJWT, authorize('admin', 'diretor'), GradeHorariaController.create);
router.get('/grade-horaria', authJWT, GradeHorariaController.list);
router.delete('/grade-horaria/:id', authJWT, authorize('admin'), GradeHorariaController.delete);

// --- Upload Foto ---
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

// --- Fim das Rotas ---
module.exports = router;
