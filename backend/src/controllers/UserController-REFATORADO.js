/**
 * UserController — REFATORADO
 *
 * ⚠️ NÃO LIGUE ISTO EM `routes/auth.js` COMO ESTÁ. NÃO É DROP-IN.
 * ============================================================================
 * Este arquivo nunca foi roteado, e `md/GUIA_MIGRACAO_USERCONTROLLER.md` o
 * descrevia como "pronto para migração" desde 30/06/2026. A auditoria de
 * paridade contra o `UserController` VIVO desmente isso em quatro pontos — três
 * deles são regressão de segurança, não diferença de estilo:
 *
 * 1. **2FA obrigatório vira opt-in.** O login vivo decide o segundo fator por
 *    `utils/politica2FA.exigeSegundoFator()`, que exige 2FA quando a conta tem
 *    `twoFactorEnabled` OU quando o PERFIL está na lista obrigatória (padrão:
 *    diretor e secretaria). O `AuthenticationService.login` olha só
 *    `user.twoFactorEnabled`. Resultado: um diretor sem a flag na conta passaria
 *    a entrar com e-mail e senha apenas — e diretor enxerga nota, frequência e
 *    dado pessoal de menor. Ver docs/2FA-OBRIGATORIO.md.
 *
 * 2. **O alvo do 2FA volta a vir do corpo da requisição.** `exports.verify2FA`
 *    aqui lê `userId` de `req.body`. O fluxo vivo usa o token de pré-autenticação
 *    (`utils/preAuthToken.js`) exatamente para isso não acontecer — o comentário
 *    em `TwoFactorController.sendCode` explica: com `userId` livre, qualquer um
 *    dispara código e reinicia o contador de tentativas na conta que quiser.
 *
 * 3. **Sem limite de tentativas no 2FA.** `TwoFactorController` tem o controle de
 *    tentativas e os códigos de backup; o `AuthenticationService` não tem nada
 *    disso. Um código de 6 dígitos sem teto de tentativas é força bruta viável.
 *
 * 4. **12 endpoints roteados hoje simplesmente não existem aqui:** googleLogin,
 *    mockGoogleLogin, getGoogleClientId, registerDiretor, registerSecretaria,
 *    verifyEmail, updateProfile, updateTutorial, updateTTSSettings, uploadFoto,
 *    removeFoto, update e anonymize. Trocar o require em `routes/auth.js`
 *    derruba todos eles de uma vez.
 *
 * Some ainda o `req.session.escolaAtivaId` que o login vivo grava — é ele que
 * fixa o tenant da sessão multi-escola.
 *
 * `backend/src/tests/userControllerRefatorado.paridade.test.js` guarda esta
 * lista: no dia em que alguém rotear este arquivo, o teste falha e aponta o que
 * falta. Enquanto ninguém rotear, ele só verifica que o arquivo segue órfão.
 * ============================================================================
 *
 * A ideia original continua boa: thin controller delegando para serviços
 * especializados (AuthenticationService, RegistrationService,
 * PasswordRecoveryService), cada um testável isoladamente. O que falta é
 * paridade — não arquitetura.
 */

const AuthenticationService = require('../services/AuthenticationService');
const RegistrationService = require('../services/RegistrationService');
const PasswordRecoveryService = require('../services/PasswordRecoveryService');
const logger = require('../utils/logger');
const { logAction } = require('../utils/auditHelper');

const JWT_EXPIRY = 8 * 60 * 60 * 1000; // 8 horas

/**
 * ════════════════════════════════════════════════════════════════
 * AUTENTICAÇÃO
 * ════════════════════════════════════════════════════════════════
 */

/**
 * POST /api/auth/login
 * Login com email/senha para acesso ao sistema
 */
exports.login = async (req, res) => {
    const { email, senha, portal } = req.body;

    const result = await AuthenticationService.login(email, senha, portal);

    if (!result.success) {
        const statusCode = result.code === 'ACCOUNT_LOCKED' ? 423 : 401;
        return res.status(statusCode).json({
            success: false,
            error: result.error,
            ...(result.minutosRestantes && { minutosRestantes: result.minutosRestantes }),
        });
    }

    // Se requer 2FA
    if (result.requires2FA) {
        return res.json(result);
    }

    // Login normal: set JWT cookie
    res.cookie('escola_jwt', result.token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'Lax',
        maxAge: JWT_EXPIRY,
    });

    res.json({
        success: true,
        requires2FA: false,
        user: result.user,
    });
};

/**
 * POST /api/auth/logout
 * Logout do usuário
 */
exports.logout = async (req, res) => {
    const result = await AuthenticationService.logout(req.user?.id);

    res.clearCookie('escola_jwt');

    res.json(result);
};

/**
 * POST /api/auth/2fa/verify
 * Verifica código 2FA e emite JWT
 */
exports.verify2FA = async (req, res) => {
    const { userId, codigo } = req.body;

    if (!userId || !codigo) {
        return res.status(400).json({
            success: false,
            error: 'userId e código são obrigatórios',
        });
    }

    const result = await AuthenticationService.verify2FA(userId, codigo);

    if (!result.success) {
        const statusCode = result.code === 'INVALID_2FA_CODE' ? 401 : 400;
        return res.status(statusCode).json({
            success: false,
            error: result.error,
        });
    }

    // Set JWT cookie
    res.cookie('escola_jwt', result.token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'Lax',
        maxAge: JWT_EXPIRY,
    });

    res.json({
        success: true,
        user: result.user,
    });
};

/**
 * ════════════════════════════════════════════════════════════════
 * REGISTRO / CADASTRO
 * ════════════════════════════════════════════════════════════════
 */

/**
 * POST /api/auth/register-responsavel
 * Cadastro público de Responsável via código secreto do aluno
 */
exports.registerResponsavel = async (req, res) => {
    const { nome, email, senha, telefone, codigoSecreto } = req.body;

    const result = await RegistrationService.registerResponsavel({
        nome,
        email,
        senha,
        telefone,
        codigoSecreto,
    });

    if (!result.success) {
        const statusCode = result.code === 'EMAIL_DUPLICATE' ? 409 : 400;
        return res.status(statusCode).json({
            success: false,
            error: result.error,
        });
    }

    // Set JWT cookie
    res.cookie('escola_jwt', result.token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'Lax',
        maxAge: JWT_EXPIRY,
    });

    res.status(201).json({
        success: true,
        message: result.message,
        user: result.user,
    });
};

/**
 * POST /api/auth/register-docente
 * Cadastro público de Docente via código secreto da escola
 */
exports.registerDocente = async (req, res) => {
    // `escolaId` vem quando o modal pré-seleciona a escola: aí o código digitado
    // tem que ser DAQUELA escola, não de qualquer uma da rede.
    const { nome, email, senha, disciplina, turma, matricula, telefone, codigoEscola, escolaId } =
        req.body;

    const result = await RegistrationService.registerDocente({
        nome,
        email,
        senha,
        disciplina,
        turma,
        matricula,
        telefone,
        codigoEscola,
        escolaId,
    });

    if (!result.success) {
        const STATUS_POR_CODIGO = { EMAIL_DUPLICATE: 409, INVALID_CODE: 403 };
        const statusCode = STATUS_POR_CODIGO[result.code] || 400;
        return res.status(statusCode).json({
            success: false,
            error: result.error,
        });
    }

    // Set JWT cookie
    res.cookie('escola_jwt', result.token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'Lax',
        maxAge: JWT_EXPIRY,
    });

    res.status(201).json({
        success: true,
        message: result.message,
        user: result.user,
    });
};

/**
 * POST /api/auth/first-access
 * Primeiro acesso de professor pré-cadastrado
 */
exports.firstAccess = async (req, res) => {
    const { emailOrCpf, password } = req.body;

    const result = await RegistrationService.firstAccess(emailOrCpf, password);

    if (!result.success) {
        const statusCode = result.code === 'ACCOUNT_EXISTS' ? 409 : 400;
        return res.status(statusCode).json({
            success: false,
            error: result.error,
        });
    }

    res.json(result);
};

/**
 * POST /api/auth/register-code
 * Cadastro com código secreto
 */
exports.registerWithCode = async (req, res) => {
    const { nome, email, senha, codigoSecreto, cpf, telefone, escolaId } = req.body;

    const result = await RegistrationService.registerWithCode({
        nome,
        email,
        senha,
        codigoSecreto,
        cpf,
        telefone,
        escolaId,
    });

    if (!result.success) {
        const STATUS_POR_CODIGO = { EMAIL_DUPLICATE: 409, INVALID_CODE: 403 };
        const statusCode = STATUS_POR_CODIGO[result.code] || 400;
        return res.status(statusCode).json({
            success: false,
            error: result.error,
        });
    }

    // Set JWT cookie
    res.cookie('escola_jwt', result.token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'Lax',
        maxAge: JWT_EXPIRY,
    });

    res.status(201).json({
        success: true,
        message: result.message,
        user: result.user,
    });
};

/**
 * ════════════════════════════════════════════════════════════════
 * RECUPERAÇÃO DE SENHA
 * ════════════════════════════════════════════════════════════════
 */

/**
 * POST /api/auth/forgot-password
 * Solicita código de recuperação de senha por email
 */
exports.forgotPassword = async (req, res) => {
    const { email } = req.body;

    const result = await PasswordRecoveryService.forgotPassword(email);

    // Sempre retorna sucesso por segurança (evita email harvesting)
    res.json(result);
};

/**
 * POST /api/auth/verify-recovery-code
 * Verifica se código de recuperação é válido
 */
exports.verifyRecoveryCode = async (req, res) => {
    const { email, codigo } = req.body;

    const result = await PasswordRecoveryService.verifyRecoveryCode(email, codigo);

    if (!result.success) {
        const statusCode = result.code === 'CODE_BLOCKED' ? 429 : 400;
        return res.status(statusCode).json({
            success: false,
            error: result.error,
        });
    }

    res.json(result);
};

/**
 * POST /api/auth/reset-password
 * Redefine senha usando código de recuperação
 */
exports.resetPassword = async (req, res) => {
    const { email, codigo, password } = req.body;

    const result = await PasswordRecoveryService.resetPassword(email, codigo, password);

    if (!result.success) {
        const statusCode = result.code === 'CODE_BLOCKED' ? 429 : 400;
        return res.status(statusCode).json({
            success: false,
            error: result.error,
        });
    }

    res.json(result);
};

/**
 * PUT /api/auth/password/force
 * Força atualização de senha (quando deveMudarSenha=true)
 * Requer autenticação
 */
exports.updatePasswordForce = async (req, res) => {
    const { newPassword } = req.body;

    if (!req.user?.id) {
        return res.status(401).json({
            success: false,
            error: 'Autenticação obrigatória',
        });
    }

    const result = await PasswordRecoveryService.updatePasswordForce(req.user.id, newPassword);

    if (!result.success) {
        return res.status(400).json({
            success: false,
            error: result.error,
        });
    }

    res.json(result);
};

/**
 * ════════════════════════════════════════════════════════════════
 * UTILITÁRIOS (a serem movidos para serviços especializados no futuro)
 * ════════════════════════════════════════════════════════════════
 */

/**
 * GET /api/users?filters...
 * Lista usuários (apenas admin)
 */
exports.list = async (req, res) => {
    try {
        const Usuario = require('../models/Usuario');

        // Apenas admin pode listar usuários
        if (req.user?.perfil !== 'admin') {
            return res.status(403).json({
                success: false,
                error: 'Apenas administradores podem listar usuários',
            });
        }

        const filters = {};
        const ALLOWED_FILTERS = ['email', 'perfil', 'ativo', 'nome'];

        Object.keys(req.query).forEach((key) => {
            if (ALLOWED_FILTERS.includes(key)) {
                filters[key] = req.query[key];
            }
        });

        const users = await Usuario.find(filters).select('-senha').lean();

        res.json({ success: true, data: users });
    } catch (error) {
        logger.error('UserController.list error', { error: error.message });
        res.status(500).json({
            success: false,
            error: error.message,
        });
    }
};

/**
 * POST /api/users
 * Cria novo usuário (apenas admin)
 */
exports.create = async (req, res) => {
    try {
        const Usuario = require('../models/Usuario');
        const bcrypt = require('bcryptjs');

        // Apenas admin pode criar usuários
        if (req.user?.perfil !== 'admin') {
            return res.status(403).json({
                success: false,
                error: 'Apenas administradores podem criar usuários',
            });
        }

        const { email, senha, ...rest } = req.body;

        if (!email || !senha) {
            return res.status(400).json({
                success: false,
                error: 'Email e senha são obrigatórios',
            });
        }

        const senhaHash = await bcrypt.hash(senha, 12);

        const user = await Usuario.create({
            email: email.toLowerCase(),
            senha: senhaHash,
            deveMudarSenha: true, // Força mudança na próxima ação
            ...rest,
        });

        await logAction(req, 'CREATE_USER', 'Usuarios', {
            recursoId: user._id,
            valorNovo: { email: user.email, perfil: user.perfil },
            descricao: `Usuário criado por admin`,
        });

        const userSafe = user.toObject();
        delete userSafe.senha;

        res.status(201).json({ success: true, data: userSafe });
    } catch (error) {
        logger.error('UserController.create error', { error: error.message });
        res.status(400).json({
            success: false,
            error: error.message,
        });
    }
};

/**
 * DELETE /api/users/:id
 * Deleta usuário (apenas admin)
 */
exports.delete = async (req, res) => {
    try {
        const Usuario = require('../models/Usuario');

        if (req.user?.perfil !== 'admin') {
            return res.status(403).json({
                success: false,
                error: 'Apenas administradores podem deletar usuários',
            });
        }

        const { id } = req.params;

        const user = await Usuario.findByIdAndDelete(id);

        if (!user) {
            return res.status(404).json({
                success: false,
                error: 'Usuário não encontrado',
            });
        }

        await logAction(req, 'DELETE_USER', 'Usuarios', {
            recursoId: id,
            descricao: `Usuário deletado por admin`,
        });

        res.json({ success: true, message: 'Usuário deletado com sucesso' });
    } catch (error) {
        logger.error('UserController.delete error', { error: error.message });
        res.status(500).json({
            success: false,
            error: error.message,
        });
    }
};

module.exports = exports;
