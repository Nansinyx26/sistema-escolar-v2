const Usuario = require('../models/Usuario');
const Professor = require('../models/Professor');
const Turma = require('../models/Turma');
const SecurityController = require('./SecurityController');
const { logAction } = require('../utils/auditHelper');
const { notificarVerificacaoEmail, notificarBruteForce } = require('../utils/emailNotifications');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const ImageProcessor = require('../utils/imageProcessor');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const ACTUAL_JWT_SECRET = require('../utils/jwtConfig');
const RecuperacaoSenha = require('../models/RecuperacaoSenha');
const EmailService = require('../services/EmailService');

const SALT_ROUNDS = 12;

function isHashed(senha) {
    return senha && senha.startsWith('$2');
}

// Configuração do transportador de e-mail
// Usa Resend SMTP como padrão. Para usar Gmail, defina EMAIL_HOST=smtp.gmail.com e EMAIL_PORT=587
const isResend = !process.env.EMAIL_HOST || process.env.EMAIL_HOST === 'smtp.resend.com';
const transporter = nodemailer.createTransport({
    host: process.env.EMAIL_HOST || 'smtp.resend.com',
    port: parseInt(process.env.EMAIL_PORT) || (isResend ? 465 : 587),
    secure: isResend, // true para Resend (465), false para Gmail (587)
    auth: {
        user: isResend ? 'resend' : process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
});

exports.list = async (req, res) => {
    try {
        const filters = {};
        const ALLOWED_FILTERS = ['email', 'perfil', 'ativo', 'nome'];
        Object.keys(req.query).forEach(key => {
            if (ALLOWED_FILTERS.includes(key)) filters[key] = req.query[key];
        });

        const users = await Usuario.find(filters).select('-senha').lean();
        res.json({ success: true, data: users });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};

exports.create = async (req, res) => {
    try {
        // Apenas Admin ou Diretor podem criar outros usuários diretamente via esta rota
        if (req.user && req.user.perfil !== 'admin') {
            const isDiretorCreatingStaff = req.user.perfil === 'diretor' && ['secretaria', 'professor'].includes(req.body.perfil);
            if (!isDiretorCreatingStaff) {
                return res.status(403).json({ success: false, error: 'Apenas administradores podem criar novos administradores ou diretores.' });
            }
        }

        // Normaliza campo de senha (suporta 'senha' ou 'password')
        const senhaBruta = req.body.senha || req.body.password;

        if (!senhaBruta && !req.body.loginGoogle) {
            return res.status(400).json({ success: false, error: 'O campo senha é obrigatório.' });
        }

        if (senhaBruta && !isHashed(senhaBruta)) {
            req.body.senha = await bcrypt.hash(senhaBruta, SALT_ROUNDS);
        }

        // Se criado por Admin, força mudança de senha no primeiro login
        req.body.deveMudarSenha = true;

        const user = await Usuario.create(req.body);

        await logAction(req, 'CREATE_USER', 'Usuarios', {
            recursoId: user._id,
            valorNovo: { email: user.email, perfil: user.perfil },
            descricao: `Usuário ${user.email} criado por ${req.user ? req.user.email : 'SISTEMA'}`
        });

        const userSafe = { ...user.toObject(), senha: undefined };
        res.status(201).json({ success: true, data: userSafe });
    } catch (error) {
        res.status(400).json({ success: false, error: error.message });
    }
};

/**
 * OPÇÍO A — PRIMEIRO ACESSO
 * Valida CPF/Email e permite definir senha se ainda não tiver conta
 */
exports.firstAccess = async (req, res) => {
    const { emailOrCpf, password } = req.body;

    try {
        // SEGURANÇA: Validação de força de senha
        if (!password || password.length < 8) {
            return res.status(400).json({ success: false, error: 'A senha deve ter no mínimo 8 caracteres.' });
        }

        // 1. Procura na coleção de Professores (pré-cadastrados pela direção)
        const prof = await Professor.findOne({
            $or: [
                { email: emailOrCpf.toLowerCase() },
                { cpf: emailOrCpf.replace(/\D/g, '') }
            ]
        });

        if (!prof) {
            return res.status(404).json({ success: false, error: 'Dados não encontrados no pré-cadastro da escola.' });
        }

        // 2. Verifica se já existe um Usuário (Login) para este professor
        const existingUser = await Usuario.findOne({ email: prof.email.toLowerCase() });
        if (existingUser && existingUser.senha) {
            return res.status(400).json({ success: false, error: 'Este e-mail já possui uma conta ativa. Use a recuperação de senha.' });
        }

        // 3. Cria ou Atualiza o Usuário com a nova senha
        const senhaHash = await bcrypt.hash(password, SALT_ROUNDS);
        let user;

        if (existingUser) {
            existingUser.senha = senhaHash;
            existingUser.ativo = true;
            await existingUser.save();
            user = existingUser;
        } else {
            user = await Usuario.create({
                nome: prof.nome,
                email: prof.email.toLowerCase(),
                senha: senhaHash,
                cpf: prof.cpf || '000.000.000-00',          // Fallback para evitar ValidationError
                telefone: prof.telefone || '(00) 00000-0000', // Fallback para evitar ValidationError
                perfil: 'professor',
                ativo: true
            });
        }

        await logAction(req, 'FIRST_ACCESS_ACTIVATE', 'Usuarios', {
            recursoId: user._id,
            descricao: `Professor ${prof.nome} ativou sua conta via Primeiro Acesso.`
        });

        res.json({ success: true, message: 'Conta ativada com sucesso! Você já pode fazer login.' });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
};

/**
 * OPÇÍO B — CADASTRO COM CÓDIGO SECRETO
 */
exports.registerWithCode = async (req, res) => {
    const { nome, email, senha, codigoEscola, cpf, telefone } = req.body;

    try {
        if (!senha || senha.length < 8) {
            return res.status(400).json({ success: false, error: 'A senha é obrigatória e deve ter no mínimo 8 caracteres.' });
        }

        // 1. Valida o código secreto do dia
        const isValid = await SecurityController.validateCode(codigoEscola);
        if (!isValid) {
            return res.status(403).json({ success: false, error: 'Código Secreto da Escola inválido ou expirado.' });
        }

        // 2. Verifica duplicidade
        const existing = await Usuario.findOne({ email: email.toLowerCase() });
        if (existing) {
            return res.status(400).json({ success: false, error: 'Este e-mail já está cadastrado.' });
        }

        // 3. Cria a conta
        const senhaHash = await bcrypt.hash(senha, SALT_ROUNDS);
        const emailVerificacaoToken = crypto.randomBytes(32).toString('hex');

        const user = await Usuario.create({
            nome,
            email: email.toLowerCase(),
            senha: senhaHash,
            cpf: cpf ? cpf.replace(/\D/g, '') : undefined,
            telefone: telefone ? telefone.replace(/\D/g, '') : undefined,
            perfil: 'professor', // Cadastro via código sempre começa como professor por segurança
            ativo: true,
            emailVerificado: false,
            emailVerificacaoToken,
            emailVerificacaoExpiry: Date.now() + 24 * 60 * 60 * 1000, // 24 horas
            deveMudarSenha: false // usuário não precisa mudar senha no primeiro acesso
        });

        await logAction(req, 'REGISTER_WITH_CODE', 'Usuarios', {
            recursoId: user._id,
            descricao: `Nova conta criada via Código Secreto por ${email}`
        });

        // Gera token JWT e define cookie HttpOnly
        const token = jwt.sign(
            { 
              id: user._id, 
              perfil: user.perfil, 
              email: user.email, 
              nome: user.nome, 
              cpf: user.cpf, 
              telefone: user.telefone, 
              profileCompleted: !!user.profileCompleted,
              tokenVersion: user.tokenVersion || 0 
            },
            ACTUAL_JWT_SECRET,
            { expiresIn: '8h' }
        );
        res.cookie('escola_jwt', token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'Lax',
            maxAge: 8 * 60 * 60 * 1000
        });

        // 4. Envia e-mail de verificação em background (não bloqueante)
        const tokenUrl = `${process.env.FRONTEND_URL || 'http://localhost:3001'}/api/auth/verify-email/${emailVerificacaoToken}`;
        notificarVerificacaoEmail(user.email, user.nome, tokenUrl).catch(err => {
            console.error('Erro ao enviar e-mail de verificação em background:', err);
        });

        // Responde indicando sucesso e que o usuário já está autenticado
        res.status(201).json({ success: true, message: 'Conta criada e autenticada com sucesso! Redirecionando...', user: { id: user._id, nome: user.nome, perfil: user.perfil, email: user.email } });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
};

function getRedirectPath(user) {
    if (!user) return '/login.html';
    if (user.deveMudarSenha) return '/mudar-senha.html';
    if (user.perfil === 'responsavel') return '/portal-responsavel/dist/index.html';
    if (!user.perfil) return '/escolher-perfil.html';
    return '/dashboard.html';
}

exports.login = async (req, res) => {
    const { email, senha } = req.body;

    try {
        const user = await Usuario.findOne({ email: email.toLowerCase() });
        if (!user || !user.ativo) {
            return res.status(401).json({ success: false, error: 'Credenciais inválidas ou conta inativa' });
        }

        // Verifica se a conta está bloqueada
        if (user.lockUntil && user.lockUntil > Date.now()) {
            const minutosRestantes = Math.ceil((user.lockUntil - Date.now()) / (60 * 1000));
            return res.status(403).json({
                success: false,
                error: `Conta bloqueada temporariamente devido a múltiplas tentativas falhas. Tente novamente em ${minutosRestantes} minutos.`
            });
        }

        // ============================================
        // SEGURANÇA: Validação de senha com migração automática de senhas legadas
        // ============================================
        let valid = false;
        if (isHashed(user.senha)) {
            // Senha já está com hash bcrypt — caminho seguro
            valid = await bcrypt.compare(senha, user.senha);
        } else {
            // LEGADO: Senha em texto puro — compara e migra automaticamente para bcrypt
            valid = (user.senha === senha);
            if (valid) {
                // Migração automática: atualiza para bcrypt hash
                // Migração automática: atualiza para bcrypt hash via updateOne para evitar ValidationError
                const senhaBcrypt = await bcrypt.hash(senha, SALT_ROUNDS);
                await Usuario.updateOne({ _id: user._id }, { $set: { senha: senhaBcrypt } });

                console.log(`🔐 [SECURITY] Senha legada de ${user.email} migrada para bcrypt automaticamente.`);
                await logAction(req, 'AUTO_MIGRATE_PASSWORD', 'Segurança', {
                    recursoId: user._id,
                    descricao: `Senha legada de ${user.email} migrada automaticamente para bcrypt.`
                });
            }
        }

        if (!valid) {
            // Incrementa tentativas de login via updateOne (bypass validation)
            const attempts = (user.loginAttempts || 0) + 1;
            const updateData = { loginAttempts: attempts };

            if (attempts >= 5) {
                updateData.lockUntil = Date.now() + 15 * 60 * 1000;
                updateData.loginAttempts = 0;
                await Usuario.updateOne({ _id: user._id }, { $set: updateData });

                // Dispara notificação de brute force para admins
                try {
                    const admins = await Usuario.find({ perfil: 'admin', ativo: true }).select('email').lean();
                    const adminEmails = admins.map(a => a.email);
                    await notificarBruteForce(adminEmails, user.email, req.ip);
                } catch (err) {
                    console.error('[BRUTE_FORCE] Erro ao notificar admins:', err.message);
                }

                return res.status(403).json({ success: false, error: 'Múltiplas tentativas falhas. Conta bloqueada por 15 minutos.' });
            }

            await Usuario.updateOne({ _id: user._id }, { $set: updateData });
            await logAction(req, 'LOGIN_FAILED', 'Auth', { descricao: `Tentativa de login falha para: ${email}` });
            return res.status(401).json({ success: false, error: 'Credenciais inválidas' });
        }

        // Login bem sucedido: Reseta tentativas via updateOne (bypass validation)
        await Usuario.updateOne({ _id: user._id }, {
            $set: { loginAttempts: 0 },
            $unset: { lockUntil: '' }
        });

        // ============================================
        // MELHORIA: Verificação 2FA — Roadmap #1
        // Se o usuário tiver 2FA ativo, NÍO emite o cookie JWT ainda.
        // Dispara o envio do código e retorna requires2FA=true.
        // O frontend exibirá a tela de código; o cookie só é setado em /api/auth/2fa/verify.
        // ============================================
        const redirect_to = getRedirectPath(user);
        // Seleciona campos extras necessários para o fluxo 2FA
        const userWith2FA = await Usuario.findById(user._id).select('+twoFactorEnabled +twoFactorFixedCode +twoFactorPendingToken +twoFactorPendingExpiry');
        const mustUse2FA = ['diretor', 'secretaria'].includes(user.perfil);
        if (userWith2FA && (userWith2FA.twoFactorEnabled || mustUse2FA)) {
            // Se houver um código fixo configurado para esta conta, use-o (não envia e-mail)
            if (userWith2FA.twoFactorFixedCode) {
                const codigo = userWith2FA.twoFactorFixedCode;
                const codigoHash = crypto.createHash('sha256').update(codigo).digest('hex');
                const expiry = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000); // válido por 1 ano

                await Usuario.findByIdAndUpdate(user._id, {
                    twoFactorPendingToken: codigoHash,
                    twoFactorPendingExpiry: expiry
                });

                console.log(`🔐 [2FA] Código fixo aplicado para ${user.email}`);
                await logAction(req, 'LOGIN_2FA_REQUIRED', 'Auth', {
                    recursoId: user._id,
                    descricao: `Login 2FA (fixo) exigido para ${user.email}`
                });

                return res.json({
                    success: true,
                    requires2FA: true,
                    userId: user._id,
                    redirect_to,
                    message: `Código de verificação fixo habilitado para ${user.email.replace(/(.{2})(.*)(@.*)/, '$1***$3')}`
                });
            }

            // Fluxo padrão: gera código aleatório, salva e envia por e-mail
            const codigo = Math.floor(100000 + Math.random() * 900000).toString();
            const codigoHash = crypto.createHash('sha256').update(codigo).digest('hex');
            const expiry = new Date(Date.now() + 5 * 60 * 1000);

            await Usuario.findByIdAndUpdate(user._id, {
                twoFactorPendingToken: codigoHash,
                twoFactorPendingExpiry: expiry
            });

            transporter.sendMail({
                from: process.env.EMAIL_FROM || `"Sistema Escolar" <noreply@escola.com>`,
                to: user.email,
                subject: '🔐 Código de verificação — Sistema Escolar',
                html: `<div style="font-family:Arial,sans-serif;max-width:480px;padding:24px;border:1px solid #e0e0e0;border-radius:8px;">
                    <h2 style="color:#1a56db;">Verificação em Dois Fatores</h2>
                    <p>Olá, <strong>${user.nome}</strong>!</p>
                    <p>Seu código de acesso:</p>
                    <div style="font-size:36px;font-weight:bold;letter-spacing:8px;background:#f4f4f4;padding:16px 24px;border-radius:6px;text-align:center;margin:16px 0;">${codigo}</div>
                    <p style="color:#666;font-size:14px;">Válido por <strong>5 minutos</strong>. Não compartilhe.</p>
                </div>`
            }).catch(err => console.error('[2FA] Erro ao enviar código:', err));

            console.log(`🔐 [2FA] Código 2FA enviado para ${user.email}`);
            await logAction(req, 'LOGIN_2FA_REQUIRED', 'Auth', {
                recursoId: user._id,
                descricao: `Login 2FA exigido para ${user.email}`
            });

            return res.json({
                success: true,
                requires2FA: true,
                userId: user._id,
                redirect_to,
                message: `Código de verificação enviado para ${user.email.replace(/(.{2})(.*)(@.*)/, '$1***$3')}`
            });
        }

        // Sem 2FA: emite o cookie JWT normalmente
        const token = jwt.sign(
            { 
              id: user._id, 
              perfil: user.perfil, 
              email: user.email, 
              nome: user.nome, 
              deveMudarSenha: user.deveMudarSenha, 
              profileCompleted: !!user.profileCompleted,
              tokenVersion: user.tokenVersion || 0 
            },
            ACTUAL_JWT_SECRET,
            { expiresIn: '8h' }
        );

        // ============================================
        // SEGURANÇA: Cookie HttpOnly — única forma de armazenar o JWT.
        // O token NÍO é enviado no corpo da resposta JSON (previne roubo via XSS).
        // ============================================
        res.cookie('escola_jwt', token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'Lax',
            maxAge: 8 * 60 * 60 * 1000 // 8h
        });

        // Atualiza ultimoLogin apenas aqui (sem 2FA)
        await Usuario.updateOne({ _id: user._id }, { $set: { ultimoLogin: new Date() } });

        res.json({
            success: true,
            requires2FA: false,
            redirect_to,
            user: {
                id: user._id,
                nome: user.nome,
                perfil: user.perfil,
                email: user.email,
                deveMudarSenha: user.deveMudarSenha,
                cpf: user.cpf,
                telefone: user.telefone,
                consentimentoAceiteEm: user.consentimentoAceiteEm,
                perfilDefinidoEm: user.perfilDefinidoEm || null,
                tutorialProfessorConcluido: !!user.tutorialProfessorConcluido,
                tutorialResponsavelConcluido: !!user.tutorialResponsavelConcluido,
                foto: user.foto || '',
                fotoGoogle: user.fotoGoogle || ''
            }
        });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
};

/**
 * MOCK GOOGLE LOGIN (Apenas para Desenvolvimento)
 * Simula o retorno do OAuth do Google e emite um JWT cookie
 * sem precisar de senha, apenas com o e-mail.
 */
exports.mockGoogleLogin = async (req, res) => {
    const { email } = req.body;

    try {
        let user = await Usuario.findOne({ email: email.toLowerCase() });

        const payload = user ? {
            id: user._id,
            perfil: user.perfil,
            email: user.email,
            nome: user.nome,
            cpf: user.cpf,
            telefone: user.telefone,
            consentimentoAceiteEm: user.consentimentoAceiteEm,
            tokenVersion: user.tokenVersion || 0
        } : {
            id: 'mock-google-id',
            perfil: 'responsavel',
            email: email,
            nome: email.split('@')[0],
            tokenVersion: 0
        };

        const token = jwt.sign({ 
            ...payload, 
            profileCompleted: user ? !!user.profileCompleted : false 
        }, ACTUAL_JWT_SECRET, { expiresIn: '8h' });

        res.cookie('escola_jwt', token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'Lax',
            maxAge: 8 * 60 * 60 * 1000
        });

        res.json({ success: true, user: payload });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
};

exports.getGoogleClientId = async (req, res) => {
    const DEFAULT_CLIENT_ID = '372860477730-co8eq29vbsafmffmfm2v2ot5givurar1.apps.googleusercontent.com';
    const clientId = process.env.GOOGLE_CLIENT_ID ? process.env.GOOGLE_CLIENT_ID.trim() : DEFAULT_CLIENT_ID;
    res.json({ success: true, clientId });
};

/**
 * REAL GOOGLE LOGIN (OAuth 2.0)
 * Verifica o ID token do Google e cria/autentica o usuário.
 */
exports.googleLogin = async (req, res) => {
    const { token } = req.body;

    if (!token) {
        return res.status(400).json({ success: false, error: 'Token Google não fornecido.' });
    }

    try {
        let email, nome, picture = '';
        const DEFAULT_CLIENT_ID = '372860477730-co8eq29vbsafmffmfm2v2ot5givurar1.apps.googleusercontent.com';
        const clientId = process.env.GOOGLE_CLIENT_ID ? process.env.GOOGLE_CLIENT_ID.trim() : DEFAULT_CLIENT_ID;

        // Se o token for um ID Token (JWT), ele começa com "eyJ" (cabeçalho padrão de JWT)
        if (token.startsWith('eyJ')) {
            const { OAuth2Client } = require('google-auth-library');
            const client = new OAuth2Client(clientId);

            const ticket = await client.verifyIdToken({
                idToken: token,
                audience: clientId,
            });
            const googlePayload = ticket.getPayload();

            email = googlePayload.email.toLowerCase();
            nome = googlePayload.name;
            picture = googlePayload.picture || '';
        } else {
            // Caso contrário, é um Access Token (fluxo popup de botão customizado)
            // Buscamos as informações do usuário diretamente na API oficial do Google
            const response = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
                headers: { Authorization: `Bearer ${token}` }
            });

            if (!response.ok) {
                throw new Error('Falha ao validar o Access Token do Google.');
            }

            const googlePayload = await response.json();
            email = googlePayload.email.toLowerCase();
            nome = googlePayload.name || googlePayload.given_name || email.split('@')[0];
            picture = googlePayload.picture || '';
        }

        let user = await Usuario.findOne({ email });

        // Se não existe, cria um Responsável automaticamente (SSO onboarding)
        if (!user) {
            // Senha fantasma que não será usada, pois ele loga com Google
            const bcrypt = require('bcryptjs');
            const crypto = require('crypto');
            const randomPass = crypto.randomBytes(16).toString('hex');
            const senhaHash = await bcrypt.hash(randomPass, 10);
            const tempCpf = `temp_cpf_${crypto.randomBytes(6).toString('hex')}`;

            user = await Usuario.create({
                nome,
                email,
                senha: senhaHash,
                cpf: tempCpf,
                telefone: '(00) 00000-0000',
                perfil: 'responsavel',
                loginGoogle: true,
                fotoGoogle: picture,
                ativo: true,
                consentimentoAceiteEm: new Date()
            });
        } else {
            // Usuário existente: sincronizar foto do Google se houver mudança
            const updateFields = { loginGoogle: true, ultimoLogin: new Date() };
            if (picture && picture !== user.fotoGoogle) {
                updateFields.fotoGoogle = picture;
            }
            // Atualizar nome do Google se o campo estiver vazio ou genérico
            if (nome && (!user.nome || user.nome === user.email.split('@')[0])) {
                updateFields.nome = nome;
            }
            user = await Usuario.findByIdAndUpdate(user._id, { $set: updateFields }, { new: true });
        }

        const jwtPayload = {
            id: user._id,
            perfil: user.perfil,
            email: user.email,
            nome: user.nome,
            cpf: user.cpf,
            telefone: user.telefone,
            fotoGoogle: user.fotoGoogle || '',
            foto: user.foto || '',
            loginGoogle: true,
            consentimentoAceiteEm: user.consentimentoAceiteEm,
            profileCompleted: !!user.profileCompleted,
            tutorialProfessorConcluido: !!user.tutorialProfessorConcluido,
            tutorialResponsavelConcluido: !!user.tutorialResponsavelConcluido,
            tokenVersion: user.tokenVersion || 0
        };

        const sessionToken = jwt.sign(jwtPayload, ACTUAL_JWT_SECRET, { expiresIn: '8h' });

        res.cookie('escola_jwt', sessionToken, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'Lax',
            path: '/',
            maxAge: 8 * 60 * 60 * 1000
        });

        res.json({ success: true, user: jwtPayload });
    } catch (e) {
        console.error('Erro na validação do Google Token:', e);
        res.status(401).json({ success: false, error: `Autenticação Google falhou: ${e.message}` });
    }
};


exports.logout = async (req, res) => {
    // clearCookie precisa das mesmas opções usadas no setCookie, senão o browser ignora
    res.clearCookie('escola_jwt', {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'Strict'
    });
    res.json({ success: true, message: 'Logout realizado com sucesso' });
};

exports.update = async (req, res) => {
    try {
        const targetId = req.params.id;
        const callingUserId = req.user._id || req.user.id;
        const callingUserPerfil = req.user.perfil;

        const oldData = await Usuario.findById(targetId).lean();
        if (!oldData) return res.status(404).json({ success: false, error: 'Usuário não encontrado' });

        // Se não for admin e não for si mesmo, verificar se é diretor alterando secretaria/professor
        if (callingUserPerfil !== 'admin' && String(targetId) !== String(callingUserId)) {
            const isDiretorManagingStaff = callingUserPerfil === 'diretor' && ['secretaria', 'professor'].includes(oldData.perfil);
            if (!isDiretorManagingStaff) {
                return res.status(403).json({ success: false, error: 'Acesso negado. Sem permissão para atualizar esta conta.' });
            }
        }

        // Whitelist de campos permitidos
        const userWhitelist = [
            'nome', 'email', 'telefone', 'cpf', 'senha', 'perfil', 'ativo', 'foto', 
            'deveMudarSenha', 'escola', 'disciplina', 'perfilDefinidoEm',
            'whatsApp', 'vinculoAluno', 'responsavelPrincipal', 'guardaLegal', 'autorizadoRetirar',
            'segundoResponsavel', 'pessoasAutorizadas', 'lgpdConsents',
            'profileCompleted', 'tutorialProfessorConcluido', 'tutorialResponsavelConcluido', 
            'consentimentoAceiteEm', 'consentimentoVersao',
            'preferenciaNarracao', 'voiceSpeed', 'accessibilityFontSize', 'accessibilityContrast', 'accessibilityReadingMode'
        ];
        const filteredBody = {};
        userWhitelist.forEach(field => {
            if (req.body[field] !== undefined) filteredBody[field] = req.body[field];
        });

        if (filteredBody.senha && !isHashed(filteredBody.senha)) {
            filteredBody.senha = await bcrypt.hash(filteredBody.senha, SALT_ROUNDS);
        }

        // Proteção: apenas admin muda o perfil para 'admin' ou muda perfil de terceiros
        if (filteredBody.perfil && filteredBody.perfil !== oldData.perfil) {
            if (callingUserPerfil !== 'admin') {
                // Usuário comum só pode escolher 'professor' ou 'diretor'
                if (!['professor', 'diretor'].includes(filteredBody.perfil)) {
                    return res.status(403).json({ success: false, error: 'Você não tem permissão para atribuir este perfil.' });
                }
            }
            // Define a data de definição de perfil automaticamente se não informada
            if (!filteredBody.perfilDefinidoEm) {
                filteredBody.perfilDefinidoEm = new Date();
            }
        }

        const user = await Usuario.findByIdAndUpdate(targetId, filteredBody, { new: true }).select('-senha');

        await logAction(req, 'UPDATE_USER', 'Usuarios', {
            recursoId: targetId,
            valorAnterior: { perfil: oldData.perfil, ativo: oldData.ativo },
            valorNovo: { perfil: user.perfil, ativo: user.ativo },
            descricao: `Usuário ${user.email} atualizado.`
        });

        res.json({ success: !!user, data: user });
    } catch (error) {
        res.status(400).json({ success: false, error: error.message });
    }
};

exports.delete = async (req, res) => {
    try {
        const user = await Usuario.findById(req.params.id);
        if (user) {
            // Apenas admin ou diretor (se o alvo for secretaria/professor) podem excluir
            const callingUserPerfil = req.user.perfil;
            if (callingUserPerfil !== 'admin') {
                const isDiretorManagingStaff = callingUserPerfil === 'diretor' && ['secretaria', 'professor'].includes(user.perfil);
                if (!isDiretorManagingStaff) {
                    return res.status(403).json({ success: false, error: 'Acesso negado. Sem permissão para excluir esta conta.' });
                }
            }

            await logAction(req, 'DELETE_USER', 'Usuarios', {
                recursoId: user._id,
                descricao: `Usuário ${user.email} excluído permanentemente.`
            });
            await Usuario.findByIdAndDelete(req.params.id);
        }
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};

/**
 * Anonimização LGPD (Em vez de excluir, remove dados identificáveis)
 */
exports.anonymize = async (req, res) => {
    try {
        const user = await Usuario.findById(req.params.id);
        if (!user) return res.status(404).json({ success: false, error: 'Usuário não encontrado.' });

        const emailOriginal = user.email;
        const idAnonimo = `anon_${Date.now()}`;

        // Limpa todos os dados sensíveis
        await Usuario.findByIdAndUpdate(req.params.id, {
            $set: {
                nome: 'Usuário Anonimizado (LGPD)',
                email: `${idAnonimo}@escola.anon`,
                cpf: '000.000.000-00',
                telefone: '(00) 00000-0000',
                ativo: false,
                senha: 'DELETADO_POR_SEGURANCA',
                ultimoLogin: null
            }
        });

        await logAction(req, 'ANONYMIZE_USER', 'Usuarios', {
            recursoId: user._id,
            descricao: `Dados do usuário ${emailOriginal} foram anonimizados conforme LGPD.`
        });

        res.json({ success: true, message: 'Usuário anonimizado com sucesso.' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};

exports.forgotPassword = async (req, res) => {
    const { email } = req.body;
    try {
        if (!email) {
            return res.status(400).json({ success: false, error: 'E-mail é obrigatório.' });
        }

        // Standard message response for security (to avoid email harvesting)
        const standardResponse = {
            success: true,
            message: 'Se o e-mail estiver cadastrado no sistema, você receberá um código de recuperação em instantes.'
        };

        // Busca pelo email informado
        const user = await Usuario.findOne({ email: email.toLowerCase(), ativo: true });
        if (!user) {
            return res.json(standardResponse);
        }

        // 1. Invalida códigos ativos anteriores deste usuário
        await RecuperacaoSenha.updateMany(
            { usuarioId: user._id, status: 'ativo' },
            { $set: { status: 'expirado' } }
        );

        // 2. Gerar código de 6 dígitos numéricos
        const code = crypto.randomInt(100000, 999999).toString();

        // 3. Salvar no banco com expiração em 15 minutos
        await RecuperacaoSenha.create({
            usuarioId: user._id,
            codigo: code,
            criadoEm: new Date(),
            expiraEm: new Date(Date.now() + 15 * 60 * 1000), // 15 minutos
            status: 'ativo',
            tentativas: 0
        });

        // Grava no arquivo local para fins de teste automatizado/E2E
        try {
            const fs = require('fs');
            const path = require('path');
            fs.writeFileSync(path.join(__dirname, '../../latest_code.txt'), code);
        } catch (fsErr) {
            console.error('Erro ao salvar latest_code.txt:', fsErr);
        }

        // 4. Enviar e-mail de código em background
        EmailService.sendVerificationCode(user.email, code, user.nome).catch(err => {
            console.error('Erro ao enviar e-mail de recuperação:', err);
        });

        // Retorna sucesso para debug em desenvolvimento se necessário, mas oculta no ambiente de produção
        if (process.env.NODE_ENV === 'development') {
            standardResponse.code_debug = code;
        }

        res.json(standardResponse);

    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
};

exports.verifyRecoveryCode = async (req, res) => {
    const { email, codigo } = req.body;
    try {
        if (!email || !codigo) {
            return res.status(400).json({ success: false, error: 'E-mail e código são obrigatórios.' });
        }

        const user = await Usuario.findOne({ email: email.toLowerCase(), ativo: true });
        if (!user) {
            return res.status(400).json({ success: false, error: 'Código inválido ou expirado.' });
        }

        // Busca código ativo para este usuário
        const recovery = await RecuperacaoSenha.findOne({
            usuarioId: user._id,
            status: 'ativo'
        });

        if (!recovery) {
            return res.status(400).json({ success: false, error: 'Código inválido ou expirado.' });
        }

        // Verifica expiração
        if (recovery.expiraEm < Date.now()) {
            recovery.status = 'expirado';
            await recovery.save();
            return res.status(400).json({ success: false, error: 'Código expirado. Solicite um novo código.' });
        }

        // Verifica limite de tentativas antes do código
        if (recovery.tentativas >= 5) {
            recovery.status = 'expirado';
            await recovery.save();
            return res.status(400).json({ success: false, error: 'Código bloqueado por excesso de tentativas. Solicite um novo código.' });
        }

        // Compara o código
        if (recovery.codigo !== codigo.trim()) {
            recovery.tentativas += 1;
            await recovery.save();

            if (recovery.tentativas >= 5) {
                recovery.status = 'expirado';
                await recovery.save();
                return res.status(400).json({ success: false, error: 'Código bloqueado por excesso de tentativas. Solicite um novo código.' });
            }

            return res.status(400).json({ success: false, error: 'Código inválido.' });
        }

        res.json({ success: true, message: 'Código verificado com sucesso.' });

    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
};

exports.resetPassword = async (req, res) => {
    const { email, codigo, password } = req.body;
    try {
        if (!email || !codigo || !password) {
            return res.status(400).json({ success: false, error: 'E-mail, código e nova senha são obrigatórios.' });
        }

        // Validação da força da senha (mínimo 8 caracteres, pelo menos uma maiúscula, pelo menos um número)
        if (password.length < 8) {
            return res.status(400).json({ success: false, error: 'A senha deve ter no mínimo 8 caracteres.' });
        }
        if (!/[A-Z]/.test(password)) {
            return res.status(400).json({ success: false, error: 'A senha deve conter pelo menos uma letra maiúscula.' });
        }
        if (!/[0-9]/.test(password)) {
            return res.status(400).json({ success: false, error: 'A senha deve conter pelo menos um número.' });
        }

        const user = await Usuario.findOne({ email: email.toLowerCase(), ativo: true });
        if (!user) {
            return res.status(400).json({ success: false, error: 'Código inválido ou expirado.' });
        }

        // Busca o código ativo
        const recovery = await RecuperacaoSenha.findOne({
            usuarioId: user._id,
            status: 'ativo'
        });

        if (!recovery) {
            return res.status(400).json({ success: false, error: 'Código inválido ou expirado.' });
        }

        // Verifica expiração
        if (recovery.expiraEm < Date.now()) {
            recovery.status = 'expirado';
            await recovery.save();
            return res.status(400).json({ success: false, error: 'Código expirado. Solicite um novo código.' });
        }

        // Verifica limite de tentativas
        if (recovery.tentativas >= 5) {
            recovery.status = 'expirado';
            await recovery.save();
            return res.status(400).json({ success: false, error: 'Código bloqueado por excesso de tentativas. Solicite um novo código.' });
        }

        // Valida se o código confere
        if (recovery.codigo !== codigo.trim()) {
            recovery.tentativas += 1;
            await recovery.save();

            if (recovery.tentativas >= 5) {
                recovery.status = 'expirado';
                await recovery.save();
                return res.status(400).json({ success: false, error: 'Código bloqueado por excesso de tentativas. Solicite um novo código.' });
            }

            return res.status(400).json({ success: false, error: 'Código inválido.' });
        }

        // Atualiza a senha do usuário
        const senhaHash = await bcrypt.hash(password, SALT_ROUNDS);
        await Usuario.updateOne(
            { _id: user._id },
            {
                $set: { senha: senhaHash },
                $inc: { tokenVersion: 1 },
                $unset: { resetToken: "", resetTokenExpiry: "" }
            }
        );

        // Marca como utilizado
        recovery.status = 'utilizado';
        await recovery.save();

        // Registra a atividade no log de auditoria
        await logAction(req, 'RESET_PASSWORD_SUCCESS', 'Usuarios', {
            recursoId: user._id,
            descricao: `Senha redefinida via código de recuperação por e-mail para ${user.email}`
        });

        res.json({ success: true, message: 'Sua senha foi alterada com sucesso!' });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
};

/**
 * Atualização de senha obrigatória (quando criado por Admin)
 */
exports.updatePasswordForce = async (req, res) => {
    const { password } = req.body;
    const userId = req.user.id;

    try {
        // Validação de força de senha
        if (!password || password.length < 8) {
            return res.status(400).json({ success: false, error: 'A senha deve ter no mínimo 8 caracteres.' });
        }

        const senhaHash = await bcrypt.hash(password, SALT_ROUNDS);

        await Usuario.findByIdAndUpdate(userId, {
            $set: {
                senha: senhaHash,
                deveMudarSenha: false // Libera o acesso
            }
        });

        await logAction(req, 'FORCE_CHANGE_PASSWORD', 'Usuarios', {
            recursoId: userId,
            descricao: `Usuário ${req.user.email} atualizou a senha obrigatória.`
        });

        res.json({ success: true, message: 'Senha atualizada com sucesso!' });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
};

/**
 * Verificação de E-mail (Roadmap #4)
 * O endpoint retorna HTML direto para que o usuário veja no navegador ao clicar no link do e-mail.
 */
exports.verifyEmail = async (req, res) => {
    try {
        const { token } = req.params;

        // Retorna o documento incluindo os campos select: false
        const user = await Usuario.findOne({
            emailVerificacaoToken: token,
            emailVerificacaoExpiry: { $gt: Date.now() }
        }).select('+emailVerificacaoToken +emailVerificacaoExpiry');

        const HTML_BASE = (titulo, mensagem, cor, icon) => `
            <!DOCTYPE html>
            <html lang="pt-BR">
            <head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
            <body style="background:#f4f4f5;font-family:Arial,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;">
                <div style="background:#fff;padding:40px;border-radius:12px;box-shadow:0 4px 12px rgba(0,0,0,0.1);text-align:center;max-width:400px;width:100%;">
                    <div style="font-size:48px;margin-bottom:16px;">${icon}</div>
                    <h2 style="color:${cor};margin-top:0;">${titulo}</h2>
                    <p style="color:#555;line-height:1.5;">${mensagem}</p>
                    <a href="${process.env.FRONTEND_URL || 'http://localhost:3001'}/index.html" style="display:inline-block;margin-top:24px;padding:12px 24px;background:#1a56db;color:#fff;text-decoration:none;border-radius:6px;font-weight:bold;">Ir para o Login</a>
                </div>
            </body>
            </html>
        `;

        if (!user) {
            return res.send(HTML_BASE(
                'Link Inválido',
                'O link de verificação é inválido ou já expirou. Por favor, solicite um novo e-mail de verificação se necessário.',
                '#dc2626',
                '❌'
            ));
        }

        user.emailVerificado = true;
        user.emailVerificacaoToken = undefined;
        user.emailVerificacaoExpiry = undefined;
        await user.save();

        res.send(HTML_BASE(
            'E-mail Verificado!',
            'Seu e-mail foi verificado com sucesso. Você já pode acessar o Sistema Escolar.',
            '#16a34a',
            '✅'
        ));

    } catch (e) {
        res.status(500).send('Erro interno do servidor.');
    }
};

const validateEmail = (email) => {
    return email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
};

const validatePasswordStrength = (password) => {
    if (!password || password.length < 8) return false;
    if (!/[A-Z]/.test(password)) return false;
    if (!/[0-9]/.test(password)) return false;
    if (!/[^A-Za-z0-9]/.test(password)) return false;
    return true;
};

/**
 * Cadastro público de Responsável (Portal do Responsável)
 */
exports.registerResponsavel = async (req, res) => {
    const { nome, email, senha, telefone, codigoSecreto } = req.body;

    try {
        if (!nome || !email || !senha || !telefone) {
            return res.status(400).json({ success: false, error: 'Todos os campos de perfil são obrigatórios (Nome, E-mail, Senha e Telefone).' });
        }

        if (!codigoSecreto) {
            return res.status(400).json({ success: false, error: 'O Código Secreto do Aluno é obrigatório. Solicite-o à direção da escola.' });
        }

        if (!validateEmail(email)) {
            return res.status(400).json({ success: false, error: 'E-mail inválido.' });
        }

        if (!validatePasswordStrength(senha)) {
            return res.status(400).json({ success: false, error: 'A senha deve ter no mínimo 8 caracteres, uma letra maiúscula, um número e um caractere especial.' });
        }

        const Usuario = require('../models/Usuario');
        const Aluno = require('../models/Aluno');
        const Notificacao = require('../models/Notificacao');

        // 1. Validar o código secreto — buscar o aluno correspondente
        const aluno = await Aluno.findOne({ codigoSecreto: codigoSecreto.trim().toUpperCase() });
        if (!aluno) {
            return res.status(400).json({ success: false, error: 'Código secreto inválido. Verifique o código fornecido pela escola e tente novamente.' });
        }

        // 2. Verificar se o aluno já possui um responsável vinculado (se for um email válido)
        if (aluno.responsavel && validateEmail(aluno.responsavel)) {
            return res.status(400).json({ success: false, error: 'Este aluno já possui um responsável vinculado. Entre em contato com a direção da escola.' });
        }

        const existingUser = await Usuario.findOne({ email: email.toLowerCase() });
        if (existingUser) {
            return res.status(400).json({ success: false, error: 'Este e-mail já está em uso.' });
        }

        const bcrypt = require('bcryptjs');
        const senhaHash = await bcrypt.hash(senha, SALT_ROUNDS);

        const now = new Date();
        const user = await Usuario.create({
            nome,
            email: email.toLowerCase(),
            senha: senhaHash,
            telefone,
            perfil: 'responsavel',
            ativo: true,
            ultimoLogin: now,
            lastLogin: now,
            consentimentoAceiteEm: now
        });

        // 3. Vincular o aluno ao responsável automaticamente
        aluno.responsavel = email.toLowerCase();
        await aluno.save();
        console.log(`🔗 [VINCULAÇÃO] Aluno "${aluno.nome}" vinculado ao responsável "${nome}" (${email}) via código secreto.`);

        // 4. Salvar Notificação persistente no banco de dados para a direção
        const hourStr = now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });
        const dateStr = now.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', timeZone: 'America/Sao_Paulo' });
        const notifMsg = `Novo responsável cadastrado às ${hourStr}`;
        
        await Notificacao.create({
            id: 'notif_reg_' + Date.now(),
            tipo: 'cadastro',
            titulo: notifMsg,
            mensagem: `${nome} se cadastrou como Responsável e foi vinculado automaticamente ao aluno "${aluno.nome}" (Turma: ${aluno.turma || aluno.turmaId}) no dia ${dateStr} às ${hourStr}.`,
            destinatarios: 'diretores',
            status: 'enviado',
            escolaId: 'default'
        });

        // 5. Notificação em Tempo Real (WebSocket)
        if (global.io) {
            global.io.emit('new-registration', {
                nome: user.nome,
                perfil: 'Responsável',
                alunoVinculado: aluno.nome,
                data: dateStr,
                horario: hourStr
            });
        }

        // 6. Logar automaticamente gerando cookie JWT
        const token = jwt.sign(
            { id: user._id, perfil: user.perfil, email: user.email, nome: user.nome, tokenVersion: user.tokenVersion || 0 },
            ACTUAL_JWT_SECRET,
            { expiresIn: '8h' }
        );
        res.cookie('escola_jwt', token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'Lax',
            maxAge: 8 * 60 * 60 * 1000
        });

        res.status(201).json({ 
            success: true, 
            message: `Conta criada com sucesso! Aluno "${aluno.nome}" vinculado automaticamente.`,
            user: { id: user._id, nome: user.nome, perfil: user.perfil, email: user.email }
        });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
};

/**
 * Cadastro público de Docente
 */
exports.registerDocente = async (req, res) => {
    const { nome, email, senha, disciplina, turma, matricula, telefone, codigoEscola } = req.body;

    try {
        if (!nome || !email || !senha || !disciplina || !turma || !matricula || !telefone || !codigoEscola) {
            return res.status(400).json({ success: false, error: 'Todos os campos são obrigatórios, incluindo o Código Secreto da Escola.' });
        }

        // Valida o código secreto do dia
        const SecurityController = require('./SecurityController');
        const isValidCode = await SecurityController.validateCode(codigoEscola);
        if (!isValidCode) {
            // Log para debug — mostra o código esperado no console do servidor
            const SecurityConfig = require('../models/SecurityConfig');
            const cfg = await SecurityConfig.findOne({ chave: 'CONFIG_GERAL' });
            console.log(`⚠️ [REGISTER-DOCENTE] Código recebido: "${codigoEscola}" | Código esperado: "${cfg?.codigoSecretoEscola}"`);
            return res.status(403).json({ success: false, error: 'Código Secreto da Escola inválido ou expirado. Solicite o código atual à direção da escola.' });
        }

        if (!validateEmail(email)) {
            return res.status(400).json({ success: false, error: 'E-mail inválido.' });
        }

        if (!validatePasswordStrength(senha)) {
            return res.status(400).json({ success: false, error: 'A senha deve ter no mínimo 8 caracteres, uma letra maiúscula, um número e um caractere especial.' });
        }

        const Usuario = require('../models/Usuario');
        const Notificacao = require('../models/Notificacao');

        const existingUser = await Usuario.findOne({ email: email.toLowerCase() });
        if (existingUser) {
            return res.status(400).json({ success: false, error: 'Este e-mail já está em uso.' });
        }

        const bcrypt = require('bcryptjs');
        const senhaHash = await bcrypt.hash(senha, SALT_ROUNDS);

        const now = new Date();
        const user = await Usuario.create({
            nome,
            email: email.toLowerCase(),
            senha: senhaHash,
            disciplina,
            turma,
            matricula,
            telefone,
            perfil: 'professor',
            ativo: true,
            ultimoLogin: now,
            lastLogin: now,
            consentimentoAceiteEm: now
        });

        // Auto-criação do registro na coleção 'professores' para vincular a turma e disciplina ao painel do professor
        const mongoose = require('mongoose');
        const Professor = require('../models/Professor');
        const materiasEspeciais = ['Inglês', 'Educação Física', 'Artes', 'SEBRAE', 'Oficina de Leitura'];
        const isEspecial = materiasEspeciais.includes(disciplina);
        
        const salaPrincipal = isEspecial ? 'VARIADOS' : turma;
        const salasAdicionais = isEspecial ? [turma] : [];
        const materias = [disciplina];

        await Professor.create({
            _id: new mongoose.Types.ObjectId().toString(),
            idUsuario: user._id.toString(),
            nome: user.nome,
            email: user.email.toLowerCase(),
            telefone: user.telefone || telefone,
            disciplina: disciplina,
            salaPrincipal: salaPrincipal,
            salasAdicionais: salasAdicionais,
            turmas: [turma],
            materias: materias,
            tipoEspecial: isEspecial,
            role: 'professor',
            ativo: true,
            escola: 'default'
        });

        // 1. Salvar Notificação persistente no banco de dados para a direção
        const hourStr = now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });
        const dateStr = now.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', timeZone: 'America/Sao_Paulo' });
        const notifMsg = `Novo docente cadastrado às ${hourStr}`;
        
        await Notificacao.create({
            id: 'notif_reg_' + Date.now(),
            tipo: 'cadastro',
            titulo: notifMsg,
            mensagem: `${nome} se cadastrou como Docente (${disciplina} - ${turma}) no dia ${dateStr} às ${hourStr}.`,
            destinatarios: 'diretores',
            status: 'enviado',
            escolaId: 'default'
        });

        // 2. Notificação em Tempo Real (WebSocket)
        if (global.io) {
            global.io.emit('new-registration', {
                nome: user.nome,
                perfil: 'Docente',
                data: dateStr,
                horario: hourStr
            });
        }

        // 3. Logar automaticamente gerando cookie JWT
        const token = jwt.sign(
            { id: user._id, perfil: user.perfil, email: user.email, nome: user.nome, tokenVersion: user.tokenVersion || 0 },
            ACTUAL_JWT_SECRET,
            { expiresIn: '8h' }
        );
        res.cookie('escola_jwt', token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'Lax',
            maxAge: 8 * 60 * 60 * 1000
        });

        res.status(201).json({ 
            success: true, 
            message: 'Conta de docente criada com sucesso!',
            user: { id: user._id, nome: user.nome, perfil: user.perfil, email: user.email }
        });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
};

/**
 * Permite ao próprio usuário atualizar seus dados cadastrais.
 * Adaptado para suportar o fluxo completo do Portal do Responsável (LGPD).
 */
exports.updateProfile = async (req, res) => {
    const userId = req.user.id || req.user._id;
    const body = req.body;

    try {
        const isResponsavel = req.user.perfil === 'responsavel';
        const updateData = {};

        // Atributos base permitidos
        if (body.nome) updateData.nome = body.nome;
        if (body.telefone) updateData.telefone = body.telefone;
        if (body.preferenciaNarracao) updateData.preferenciaNarracao = body.preferenciaNarracao;
        if (body.email && isResponsavel) updateData.email = body.email.toLowerCase();
        // Foto de perfil (ID do GridFS ou string vazia para remover)
        if (body.foto !== undefined) updateData.foto = body.foto;

        // ── Preferências de voz e acessibilidade (todos os perfis) ──────────
        const VOICE_FIELDS = [
            'voiceSpeed', 'voiceGender', 'ttsProvider',
            'accessibilityFontSize', 'accessibilityReadingMode', 'accessibilityContrast'
        ];
        VOICE_FIELDS.forEach(field => {
            if (body[field] !== undefined) updateData[field] = body[field];
        });

        // CPF apenas para docentes
        if (!isResponsavel && body.cpf) {
            if (!/^\d{3}\.\d{3}\.\d{3}-\d{2}$/.test(body.cpf)) {
                return res.status(400).json({ success: false, error: 'CPF inválido.' });
            }
            const existingCpf = await Usuario.findOne({ cpf: body.cpf, _id: { $ne: userId } });
            if (existingCpf) {
                return res.status(400).json({ success: false, error: 'Este CPF já está cadastrado.' });
            }
            updateData.cpf = body.cpf;
        }

        // Atributos específicos do Responsável (Onboarding LGPD)
        if (isResponsavel) {
            const responsavelFields = [
                'whatsApp', 'vinculoAluno', 'responsavelPrincipal', 'guardaLegal', 
                'autorizadoRetirar', 'segundoResponsavel', 'pessoasAutorizadas', 
                'lgpdConsents', 'profileCompleted'
            ];
            
            responsavelFields.forEach(field => {
                if (body[field] !== undefined) updateData[field] = body[field];
            });

            if (body.consentimentoAceiteEm) {
                updateData.consentimentoAceiteEm = new Date();
            }

            // Gerar contaId se profileCompleted estiver sendo marcado como true pela primeira vez
            const currentUser = await Usuario.findById(userId).select('contaId profileCompleted');
            if (body.profileCompleted === true && (!currentUser.profileCompleted || !currentUser.contaId)) {
                // Se ainda não tem ID de conta, gera um novo: RP-XXXXXX
                // Conta quantos usuários já possuem contaId para gerar o próximo
                const count = await Usuario.countDocuments({ contaId: { $ne: null }, perfil: 'responsavel' });
                const nextIdNum = count + 1;
                const paddedId = String(nextIdNum).padStart(6, '0');
                updateData.contaId = `RP-${paddedId}`;
                updateData.profileCompletedEm = new Date();
                console.log(`🆔 [ONBOARDING] Gerado novo ContaID: ${updateData.contaId} para ${req.user.email}`);

                // Sincronização Automática: Vincular alunos que já tenham este e-mail como responsável
                const Aluno = require('../models/Aluno');
                const result = await Aluno.updateMany(
                    { responsavel: req.user.email.toLowerCase() },
                    { $set: { responsavelId: userId } }
                );
                if (result.modifiedCount > 0) {
                    console.log(`🔗 [ONBOARDING] ${result.modifiedCount} aluno(s) vinculados automaticamente ao ID ${userId}`);
                }
            }
        }

        const updateQuery = { $set: updateData };

        // Registro de Histórico LGPD (Imutável)
        if (isResponsavel && body.newLgpdRecords && Array.isArray(body.newLgpdRecords)) {
            const userAgent = req.headers['user-agent'] || 'Desconhecido';
            const os = userAgent.includes('Windows') ? 'Windows' : 
                       userAgent.includes('Mac') ? 'MacOS' : 
                       userAgent.includes('Android') ? 'Android' : 
                       userAgent.includes('iOS') ? 'iOS' : 'Outro';
            
            const historyEntries = body.newLgpdRecords.map(record => ({
                termoId: record.termoId,
                versao: record.versao || '1.0',
                aceitoEm: new Date(),
                ip: req.ip || '127.0.0.1',
                browser: userAgent.substring(0, 200),
                os: os,
                loginType: record.loginType || (req.user.loginGoogle ? 'Google' : 'Conta Local')
            }));

            updateQuery.$push = { lgpdHistory: { $each: historyEntries } };
        }

        const user = await Usuario.findByIdAndUpdate(userId, updateQuery, { new: true }).lean();
        if (!user) return res.status(404).json({ success: false, error: 'Usuário não encontrado.' });

        // LOG DE AUDITORIA
        await logAction(req, 'UPDATE_PROFILE', 'Usuarios', {
            recursoId: userId,
            descricao: isResponsavel ? `Perfil do Responsável ${user.email} atualizado (Onboarding/LGPD).` : `Perfil de ${user.email} atualizado.`
        });

        const { senha, loginAttempts, __v, ...safeUser } = user;
        if (!safeUser.id) safeUser.id = String(user._id);

        // Se o cadastro foi concluído agora, garantir que o contaId esteja no retorno
        if (user.contaId) {
            safeUser.contaId = user.contaId;
        }

        res.json({ success: true, user: safeUser });
    } catch (e) {
        console.error('Erro ao atualizar perfil:', e);
        res.status(500).json({ success: false, error: e.message });
    }
};

/**
 * Atualiza status do tour guiado (onboarding)
 */
exports.updateTutorial = async (req, res) => {
    const userId = req.user.id || req.user._id;
    const body = req.body;

    try {
        const updateData = {};

        if (body.tutorialProfessorConcluido !== undefined) {
            updateData.tutorialProfessorConcluido = !!body.tutorialProfessorConcluido;
            if (body.tutorialProfessorConcluido) updateData.tutorialProfessorConcluidoEm = new Date();
        }
        if (body.tutorialResponsavelConcluido !== undefined) {
            updateData.tutorialResponsavelConcluido = !!body.tutorialResponsavelConcluido;
            if (body.tutorialResponsavelConcluido) updateData.tutorialResponsavelConcluidoEm = new Date();
        }

        if (Object.keys(updateData).length === 0) {
            return res.status(400).json({ success: false, error: 'Nenhum campo de tutorial informado.' });
        }

        const user = await Usuario.findByIdAndUpdate(userId, { $set: updateData }, { new: true }).lean();
        if (!user) return res.status(404).json({ success: false, error: 'Usuário não encontrado.' });

        const { senha, loginAttempts, __v, ...safeUser } = user;
        if (!safeUser.id) safeUser.id = String(user._id);
        res.json({ success: true, user: safeUser });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
};




// ============================================
// UPLOAD MANUAL DE FOTO DE PERFIL
// ============================================
const MAX_PHOTO_B64_BYTES = 3 * 1024 * 1024; // 3MB — mesmo limite de comunicados

/**
 * PUT /api/usuarios/foto
 * Recebe { foto: "data:image/...;base64,..." }, converte para WebP e salva no campo `foto`.
 * Nunca altera fotoGoogle nem loginGoogle.
 */
exports.uploadFoto = async (req, res) => {
    const userId = req.user.id || req.user._id;
    const { foto } = req.body;

    try {
        // Validação: campo obrigatório
        if (!foto || typeof foto !== 'string') {
            return res.status(400).json({ success: false, error: 'Campo "foto" é obrigatório e deve ser uma string base64.' });
        }

        // Validação: deve começar com data:image/
        if (!foto.startsWith('data:image/')) {
            return res.status(400).json({ success: false, error: 'Formato inválido. A foto deve ser uma string base64 com prefixo data:image/.' });
        }

        // Validação: tamanho máximo (~3MB de base64)
        const base64Part = foto.split(',')[1] || '';
        if (base64Part.length > MAX_PHOTO_B64_BYTES) {
            return res.status(400).json({ success: false, error: 'Imagem muito grande. Máximo permitido: 3MB.' });
        }

        // Converte para WebP (pula se já for WebP)
        let fotoFinal;
        if (foto.startsWith('data:image/webp')) {
            fotoFinal = foto;
        } else {
            try {
                fotoFinal = await ImageProcessor.convertToWebPBase64(foto, 82);
            } catch (convErr) {
                console.error('[uploadFoto] Erro na conversão para WebP:', convErr.message);
                return res.status(400).json({ success: false, error: 'Formato de imagem não suportado. Use JPG, PNG ou WebP.' });
            }
        }

        // Salva apenas o campo foto (nunca toca em fotoGoogle nem loginGoogle)
        const user = await Usuario.findByIdAndUpdate(
            userId,
            { $set: { foto: fotoFinal } },
            { new: true }
        ).lean();

        if (!user) {
            return res.status(404).json({ success: false, error: 'Usuário não encontrado.' });
        }

        // Retorna sem campos sensíveis
        const { senha, twoFactorSecret, twoFactorPendingToken, twoFactorPendingExpiry,
                emailVerificacaoToken, emailVerificacaoExpiry, loginAttempts, lockUntil, __v, ...safeUser } = user;
        if (!safeUser.id) safeUser.id = String(user._id);

        await logAction(req, 'UPLOAD_PROFILE_PHOTO', 'Usuarios', {
            recursoId: userId,
            descricao: `Foto de perfil atualizada para ${user.email}.`
        });

        res.json({ success: true, user: safeUser });
    } catch (e) {
        console.error('[uploadFoto] Erro:', e.message);
        res.status(500).json({ success: false, error: e.message });
    }
};

/**
 * DELETE /api/usuarios/foto
 * Remove a foto manual do usuário autenticado (seta foto: null).
 * O sistema volta a usar fotoGoogle (se existir) ou iniciais.
 */
exports.removeFoto = async (req, res) => {
    const userId = req.user.id || req.user._id;

    try {
        const user = await Usuario.findByIdAndUpdate(
            userId,
            { $set: { foto: null } },
            { new: true }
        ).lean();

        if (!user) {
            return res.status(404).json({ success: false, error: 'Usuário não encontrado.' });
        }

        const { senha, twoFactorSecret, twoFactorPendingToken, twoFactorPendingExpiry,
                emailVerificacaoToken, emailVerificacaoExpiry, loginAttempts, lockUntil, __v, ...safeUser } = user;
        if (!safeUser.id) safeUser.id = String(user._id);

        await logAction(req, 'REMOVE_PROFILE_PHOTO', 'Usuarios', {
            recursoId: userId,
            descricao: `Foto de perfil removida para ${user.email}.`
        });

        res.json({ success: true, user: safeUser });
    } catch (e) {
        console.error('[removeFoto] Erro:', e.message);
        res.status(500).json({ success: false, error: e.message });
    }
};


/**
 * POST /api/auth/settings/tts
 * Atualiza as configurações de voz do usuário no MongoDB.
 */
exports.updateTTSSettings = async (req, res) => {
    const userId = req.user.id || req.user._id;
    const { ttsProvider, voicePreference, speed, narrationMode } = req.body;

    try {
        const updateData = {};
        if (ttsProvider)     updateData['settings.ttsProvider']     = ttsProvider;
        if (voicePreference) updateData['settings.voicePreference'] = voicePreference;
        if (speed !== undefined) updateData['settings.speed']       = Number(speed);
        if (narrationMode)   updateData['settings.narrationMode']   = narrationMode;

        // Também atualiza os campos legados para retrocompatibilidade
        if (ttsProvider)     updateData.ttsProvider         = ttsProvider;
        if (voicePreference) updateData.voiceGender         = voicePreference;
        if (speed !== undefined) updateData.voiceSpeed      = Number(speed);
        if (narrationMode)   updateData.preferenciaNarracao = narrationMode;

        const user = await Usuario.findByIdAndUpdate(
            userId,
            { $set: updateData },
            { new: true, runValidators: true }
        ).lean();

        if (!user) {
            return res.status(404).json({ success: false, error: 'Usuário não encontrado.' });
        }

        // Log da ação
        await logAction(req, 'UPDATE_TTS_SETTINGS', 'Usuarios', {
            recursoId: userId,
            valorNovo: user.settings,
            descricao: `Configurações de TTS atualizadas para ${user.email}.`
        });

        res.json({ 
            success: true, 
            settings: user.settings,
            // Retorna safeUser completo para sync no frontend
            user: {
                id: user._id,
                nome: user.nome,
                perfil: user.perfil,
                email: user.email,
                settings: user.settings
            }
        });
    } catch (e) {
        console.error('[updateTTSSettings] Erro:', e.message);
        res.status(500).json({ success: false, error: e.message });
    }
};

/**
 * Cadastro público de Diretor
 * Requer Código Secreto da Escola (validação diária)
 */
exports.registerDiretor = async (req, res) => {
    const { nome, email, senha, telefone, escola, codigoEscola } = req.body;

    try {
        if (!nome || !email || !senha || !telefone || !codigoEscola) {
            return res.status(400).json({ success: false, error: 'Todos os campos são obrigatórios, incluindo o Código Secreto da Escola.' });
        }

        // 1. Valida o código secreto do dia
        const SecurityController = require('./SecurityController');
        const isValidCode = await SecurityController.validateCode(codigoEscola);
        if (!isValidCode) {
            const SecurityConfig = require('../models/SecurityConfig');
            const cfg = await SecurityConfig.findOne({ chave: 'CONFIG_GERAL' });
            console.log(`⚠️ [REGISTER-DIRETOR] Código recebido: "${codigoEscola}" | Código esperado: "${cfg?.codigoSecretoEscola}"`);
            return res.status(403).json({ success: false, error: 'Código Secreto da Escola inválido ou expirado. Solicite o código atual à direção da escola.' });
        }

        // 2. Validações básicas
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            return res.status(400).json({ success: false, error: 'E-mail inválido.' });
        }

        if (senha.length < 8 || !/[A-Z]/.test(senha) || !/[0-9]/.test(senha) || !/[^A-Za-z0-9]/.test(senha)) {
            return res.status(400).json({ success: false, error: 'A senha deve ter no mínimo 8 caracteres, uma letra maiúscula, um número e um caractere especial.' });
        }

        const Usuario = require('../models/Usuario');
        const Notificacao = require('../models/Notificacao');

        const existingUser = await Usuario.findOne({ email: email.toLowerCase() });
        if (existingUser) {
            return res.status(400).json({ success: false, error: 'Este e-mail já está em uso.' });
        }

        // 3. Cria a conta
        const bcrypt = require('bcryptjs');
        const senhaHash = await bcrypt.hash(senha, SALT_ROUNDS);

        const now = new Date();
        const user = await Usuario.create({
            nome,
            email: email.toLowerCase(),
            senha: senhaHash,
            telefone,
            escola: escola || undefined,
            perfil: 'diretor',
            ativo: true,
            ultimoLogin: now,
            lastLogin: now,
            consentimentoAceiteEm: now
        });

        // 4. Auto-criação do registro na coleção 'diretores'
        const mongoose = require('mongoose');
        const Diretor = require('../models/Diretor');

        await Diretor.create({
            _id: new mongoose.Types.ObjectId().toString(),
            idUsuario: user._id.toString(),
            nome: user.nome,
            email: user.email.toLowerCase(),
            telefone: user.telefone || telefone,
            escola: escola || 'default',
            role: 'director',
            ativo: true
        });

        // 5. Notificação persistente
        const hourStr = now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });
        const dateStr = now.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', timeZone: 'America/Sao_Paulo' });
        const notifMsg = `Novo diretor cadastrado às ${hourStr}`;
        
        await Notificacao.create({
            id: 'notif_reg_' + Date.now(),
            tipo: 'cadastro',
            titulo: notifMsg,
            mensagem: `${nome} se cadastrou como Diretor${escola ? ` (${escola})` : ''} no dia ${dateStr} às ${hourStr}.`,
            destinatarios: 'diretores',
            status: 'enviado',
            escolaId: 'default'
        });

        // 6. WebSocket
        if (global.io) {
            global.io.emit('new-registration', {
                nome: user.nome,
                perfil: 'Diretor',
                data: dateStr,
                horario: hourStr
            });
        }

        // 7. JWT auto-login
        const token = jwt.sign(
            { id: user._id, perfil: user.perfil, email: user.email, nome: user.nome, tokenVersion: user.tokenVersion || 0 },
            ACTUAL_JWT_SECRET,
            { expiresIn: '8h' }
        );
        res.cookie('escola_jwt', token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'Lax',
            maxAge: 8 * 60 * 60 * 1000
        });

        res.status(201).json({ 
            success: true, 
            message: 'Conta de diretor criada com sucesso!',
            user: { id: user._id, nome: user.nome, perfil: user.perfil, email: user.email }
        });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
};

/**
 * Cadastro público de Secretaria
 * Requer Código Secreto da Escola (validação diária)
 */
exports.registerSecretaria = async (req, res) => {
    const { nome, email, senha, telefone, escola, codigoEscola } = req.body;

    try {
        if (!nome || !email || !senha || !telefone || !codigoEscola) {
            return res.status(400).json({ success: false, error: 'Todos os campos são obrigatórios, incluindo o Código Secreto da Escola.' });
        }

        // 1. Valida o código secreto do dia
        const SecurityController = require('./SecurityController');
        const isValidCode = await SecurityController.validateCode(codigoEscola);
        if (!isValidCode) {
            const SecurityConfig = require('../models/SecurityConfig');
            const cfg = await SecurityConfig.findOne({ chave: 'CONFIG_GERAL' });
            console.log(`⚠️ [REGISTER-SECRETARIA] Código recebido: "${codigoEscola}" | Código esperado: "${cfg?.codigoSecretoEscola}"`);
            return res.status(403).json({ success: false, error: 'Código Secreto da Escola inválido ou expirado. Solicite o código atual à direção da escola.' });
        }

        // 2. Validações básicas
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            return res.status(400).json({ success: false, error: 'E-mail inválido.' });
        }

        if (senha.length < 8 || !/[A-Z]/.test(senha) || !/[0-9]/.test(senha) || !/[^A-Za-z0-9]/.test(senha)) {
            return res.status(400).json({ success: false, error: 'A senha deve ter no mínimo 8 caracteres, uma letra maiúscula, um número e um caractere especial.' });
        }

        const Usuario = require('../models/Usuario');
        const Notificacao = require('../models/Notificacao');

        const existingUser = await Usuario.findOne({ email: email.toLowerCase() });
        if (existingUser) {
            return res.status(400).json({ success: false, error: 'Este e-mail já está em uso.' });
        }

        // 3. Cria a conta
        const bcrypt = require('bcryptjs');
        const senhaHash = await bcrypt.hash(senha, SALT_ROUNDS);

        const now = new Date();
        const user = await Usuario.create({
            nome,
            email: email.toLowerCase(),
            senha: senhaHash,
            telefone,
            escola: escola || undefined,
            perfil: 'secretaria',
            ativo: true,
            ultimoLogin: now,
            lastLogin: now,
            consentimentoAceiteEm: now
        });

        // 4. Auto-criação do registro na coleção 'secretarias'
        const mongoose = require('mongoose');
        const Secretaria = require('../models/Secretaria');

        await Secretaria.create({
            _id: new mongoose.Types.ObjectId().toString(),
            idUsuario: user._id.toString(),
            nome: user.nome,
            email: user.email.toLowerCase(),
            telefone: user.telefone || telefone,
            escola: escola || 'default',
            setor: 'Secretaria Geral',
            cargo: 'Secretário(a)',
            ativo: true
        });

        // 5. Notificação persistente
        const hourStr = now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });
        const dateStr = now.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', timeZone: 'America/Sao_Paulo' });
        const notifMsg = `Nova secretaria cadastrada às ${hourStr}`;
        
        await Notificacao.create({
            id: 'notif_reg_' + Date.now(),
            tipo: 'cadastro',
            titulo: notifMsg,
            mensagem: `${nome} se cadastrou como Secretaria${escola ? ` (${escola})` : ''} no dia ${dateStr} às ${hourStr}.`,
            destinatarios: 'diretores',
            status: 'enviado',
            escolaId: 'default'
        });

        // 6. WebSocket
        if (global.io) {
            global.io.emit('new-registration', {
                nome: user.nome,
                perfil: 'Secretaria',
                data: dateStr,
                horario: hourStr
            });
        }

        // 7. JWT auto-login
        const token = jwt.sign(
            { id: user._id, perfil: user.perfil, email: user.email, nome: user.nome, tokenVersion: user.tokenVersion || 0 },
            ACTUAL_JWT_SECRET,
            { expiresIn: '8h' }
        );
        res.cookie('escola_jwt', token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'Lax',
            maxAge: 8 * 60 * 60 * 1000
        });

        res.status(201).json({ 
            success: true, 
            message: 'Conta de secretaria criada com sucesso!',
            user: { id: user._id, nome: user.nome, perfil: user.perfil, email: user.email }
        });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
};
