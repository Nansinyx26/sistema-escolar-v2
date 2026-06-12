const express = require('express');
const router = express.Router();

const UserController = require('../controllers/UserController');
const ClassController = require('../controllers/ClassController');
const SecurityController = require('../controllers/SecurityController');
const TwoFactorController = require('../controllers/TwoFactorController');
const authJWT = require('../middleware/authJWT');

// --- Autenticação Pública ---
router.post('/login', UserController.login);
router.post('/mock-google-login', UserController.mockGoogleLogin);
router.post('/google-login', UserController.googleLogin);
router.get('/google-client-id', UserController.getGoogleClientId);
router.post('/logout', UserController.logout);
router.post('/register-responsavel', UserController.registerResponsavel);
router.post('/register-docente', UserController.registerDocente);
router.get('/turmas-publicas', ClassController.list);
router.post('/forgot-password', UserController.forgotPassword);
router.post('/verify-recovery-code', UserController.verifyRecoveryCode);
router.post('/reset-password', UserController.resetPassword);
router.post('/validate-code', (req, res) => SecurityController.validateCodePublic(req, res));

// --- Verificar sessão atual (JWT cookie) ---
router.get('/me', authJWT, async (req, res) => {
    try {
        const Usuario = require('../models/Usuario');
        const userId = req.user?.id || req.user?._id;
        if (!userId) return res.status(401).json({ success: false, error: 'Não autenticado' });

        const user = await Usuario.findById(userId).lean();
        if (!user) return res.status(401).json({ success: false, error: 'Usuário não encontrado' });

        const { senha, loginAttempts, __v, ...safeUser } = user;
        if (!safeUser.id) safeUser.id = String(user._id);
        
        res.json({ success: true, user: safeUser });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

router.put('/profile', authJWT, UserController.updateProfile);

router.put('/tutorial', authJWT, UserController.updateTutorial);

// --- 2FA (Autenticação de Dois Fatores) ---
router.post('/2fa/send', TwoFactorController.sendCode);
router.post('/2fa/verify', TwoFactorController.verifyCode);
router.get('/2fa/status', authJWT, TwoFactorController.status);
router.post('/2fa/enable', authJWT, TwoFactorController.enable);
router.post('/2fa/disable', authJWT, TwoFactorController.disable);

// --- Outras Opções de Cadastro / Ativação ---
router.post('/first-access', UserController.firstAccess);
router.post('/register-code', UserController.registerWithCode);
router.post('/update-password-force', authJWT, UserController.updatePasswordForce);
router.get('/verify-email/:token', UserController.verifyEmail);

module.exports = router;
