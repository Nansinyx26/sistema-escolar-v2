const Usuario = require('../models/Usuario');
const Professor = require('../models/Professor');
const Turma = require('../models/Turma');
const SecurityController = require('./SecurityController');
const { logAction } = require('../utils/auditHelper');
const { notificarVerificacaoEmail } = require('../utils/emailNotifications');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const ImageProcessor = require('../utils/imageProcessor');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const ACTUAL_JWT_SECRET = require('../utils/jwtConfig');

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
        // Apenas Admin pode criar outros usuários diretamente via esta rota
        if (req.user && req.user.perfil !== 'admin') {
            return res.status(403).json({ success: false, error: 'Apenas administradores podem criar usuários diretamente.' });
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
            emailVerificacaoExpiry: Date.now() + 24 * 60 * 60 * 1000 // 24 horas
        });

        await logAction(req, 'REGISTER_WITH_CODE', 'Usuarios', {
            recursoId: user._id,
            descricao: `Nova conta criada via Código Secreto por ${email}`
        });

        // 4. Envia e-mail de verificação
        const tokenUrl = `${process.env.FRONTEND_URL || 'http://localhost:3001'}/api/auth/verify-email/${emailVerificacaoToken}`;
        await notificarVerificacaoEmail(user.email, user.nome, tokenUrl);

        res.status(201).json({ success: true, message: 'Conta criada com sucesso! Verifique seu e-mail para ativar.' });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
};

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
        const userWith2FA = await Usuario.findById(user._id).select('+twoFactorEnabled');
        if (userWith2FA && userWith2FA.twoFactorEnabled) {
            // Gera e salva código de 6 dígitos (hash sha256, 5 min de validade)
            const crypto = require('crypto');
            const codigo = Math.floor(100000 + Math.random() * 900000).toString();
            const codigoHash = crypto.createHash('sha256').update(codigo).digest('hex');
            const expiry = new Date(Date.now() + 5 * 60 * 1000);

            await Usuario.findByIdAndUpdate(user._id, {
                twoFactorPendingToken: codigoHash,
                twoFactorPendingExpiry: expiry
            });

            // Envia o código por e-mail (em background)
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

            return res.json({
                success: true,
                requires2FA: true,
                userId: user._id,
                message: `Código de verificação enviado para ${user.email.replace(/(.{2})(.*)(@.*)/, '$1***$3')}`
            });
        }

        // Sem 2FA: emite o cookie JWT normalmente
        const token = jwt.sign(
            { id: user._id, perfil: user.perfil, email: user.email, nome: user.nome, deveMudarSenha: user.deveMudarSenha },
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
            sameSite: 'Strict',
            maxAge: 8 * 60 * 60 * 1000 // 8h
        });

        // Atualiza ultimoLogin apenas aqui (sem 2FA)
        await Usuario.updateOne({ _id: user._id }, { $set: { ultimoLogin: new Date() } });

        res.json({
            success: true,
            requires2FA: false,
            user: { id: user._id, nome: user.nome, perfil: user.perfil, email: user.email, deveMudarSenha: user.deveMudarSenha }
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
            nome: user.nome 
        } : { 
            id: 'mock-google-id', 
            perfil: 'responsavel', 
            email: email, 
            nome: email.split('@')[0] 
        };

        const token = jwt.sign(payload, ACTUAL_JWT_SECRET, { expiresIn: '8h' });

        res.cookie('escola_jwt', token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'Strict',
            maxAge: 8 * 60 * 60 * 1000
        });

        res.json({ success: true, user: payload });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
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
        let email, nome;
        const DEFAULT_CLIENT_ID = '372860477730-co8eq29vbsafmffmfm2v2ot5givurar1.apps.googleusercontent.com';
        const clientId = process.env.GOOGLE_CLIENT_ID || DEFAULT_CLIENT_ID;

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
                ativo: true,
                consentimentoAceiteEm: new Date()
            });
        }
        
        const jwtPayload = { 
            id: user._id, 
            perfil: user.perfil, 
            email: user.email, 
            nome: user.nome 
        };

        const sessionToken = jwt.sign(jwtPayload, ACTUAL_JWT_SECRET, { expiresIn: '8h' });

        res.cookie('escola_jwt', sessionToken, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'Strict',
            maxAge: 8 * 60 * 60 * 1000
        });

        res.json({ success: true, user: jwtPayload });
    } catch (e) {
        console.error('Erro na validação do Google Token:', e);
        res.status(401).json({ success: false, error: 'Autenticação Google falhou ou token é inválido.' });
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
        const oldData = await Usuario.findById(targetId).lean();
        if (!oldData) return res.status(404).json({ success: false, error: 'Usuário não encontrado' });

        // Whitelist de campos permitidos
        const userWhitelist = ['nome', 'email', 'telefone', 'cpf', 'senha', 'perfil', 'ativo', 'foto', 'deveMudarSenha', 'escola', 'disciplina'];
        const filteredBody = {};
        userWhitelist.forEach(field => {
            if (req.body[field] !== undefined) filteredBody[field] = req.body[field];
        });

        if (filteredBody.senha && !isHashed(filteredBody.senha)) {
            filteredBody.senha = await bcrypt.hash(filteredBody.senha, SALT_ROUNDS);
        }

        // Proteção: apenas admin muda o perfil (role)
        if (filteredBody.perfil && req.user.perfil !== 'admin' && filteredBody.perfil !== oldData.perfil) {
            return res.status(403).json({ success: false, error: 'Apenas administradores podem alterar perfis de acesso.' });
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
    const { email, cpf, telefone } = req.body;
    try {
        const user = await Usuario.findOne({ email, cpf, telefone });
        if (!user) return res.status(404).json({ success: false, error: 'Dados não conferem.' });

        // 1. Gerar Token UUID v4 (seguro)
        const token = crypto.randomUUID();
        
        // 2. Salvar no banco com TTL de 15 minutos
        user.resetToken = token;
        user.resetTokenExpiry = Date.now() + 15 * 60 * 1000; // 15 min
        await user.save();

        // 3. Enviar link por e-mail
        const resetUrl = `${process.env.FRONTEND_URL || 'http://localhost:3001'}/reset-password.html?token=${token}`;
        
        const mailOptions = {
            from: `"Sistema Escolar" <${process.env.EMAIL_USER}>`,
            to: user.email,
            subject: 'Recuperação de Senha — Sistema Escolar',
            html: `
                <h3>Olá, ${user.nome}!</h3>
                <p>Recebemos uma solicitação para redefinir sua senha.</p>
                <p>Clique no link abaixo para criar uma nova senha (válido por 15 minutos):</p>
                <a href="${resetUrl}" style="padding: 10px 20px; background: #2563eb; color: white; text-decoration: none; border-radius: 5px;">Redefinir Minha Senha</a>
                <p>Se você não solicitou isso, ignore este e-mail.</p>
                <br>
                <small>Link direto: ${resetUrl}</small>
            `
        };

        // Envia o e-mail (em background para não travar a resposta)
        transporter.sendMail(mailOptions).catch(err => console.error('Erro ao enviar e-mail:', err));

        res.json({ 
            success: true, 
            message: 'Se os dados estiverem corretos, um link de recuperação será enviado para seu e-mail.',
            token_debug: process.env.NODE_ENV === 'development' ? token : undefined 
        });

    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
};

exports.resetPassword = async (req, res) => {
    const { token, password } = req.body;
    try {
        // 1. Busca usuário com token válido e não expirado
        const user = await Usuario.findOne({
            resetToken: token,
            resetTokenExpiry: { $gt: Date.now() }
        });

        if (!user) {
            return res.status(400).json({ success: false, error: 'Token inválido ou expirado.' });
        }

        // 2. Atualiza a senha e limpa tokens
        const senhaHash = await bcrypt.hash(password, SALT_ROUNDS);
        await Usuario.updateOne(
            { _id: user._id },
            { 
                $set: { senha: senhaHash },
                $unset: { resetToken: "", resetTokenExpiry: "" }
            }
        );

        await logAction(req, 'RESET_PASSWORD_SUCCESS', 'Usuarios', { 
            recursoId: user._id, 
            descricao: `Senha redefinida via token para ${user.email}` 
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

/**
 * Cadastro público de Responsável (Portal do Responsável)
 */
exports.registerResponsavel = async (req, res) => {
    const { nome, email, senha, cpf, telefone } = req.body;
    
    try {
        if (!nome || !email || !senha) {
            return res.status(400).json({ success: false, error: 'Nome, e-mail e senha são obrigatórios.' });
        }

        const Usuario = require('../models/Usuario');
        const existingUser = await Usuario.findOne({ email: email.toLowerCase() });
        if (existingUser) {
            return res.status(400).json({ success: false, error: 'Este e-mail já está em uso.' });
        }

        const bcrypt = require('bcryptjs');
        const senhaHash = await bcrypt.hash(senha, process.env.SALT_ROUNDS ? parseInt(process.env.SALT_ROUNDS) : 10);

        const user = await Usuario.create({
            nome,
            email: email.toLowerCase(),
            senha: senhaHash,
            cpf: cpf || '000.000.000-00',
            telefone: telefone || '(00) 00000-0000',
            perfil: 'responsavel',
            ativo: true,
            consentimentoAceiteEm: new Date()
        });

        res.status(201).json({ success: true, message: 'Conta criada com sucesso! Você já pode fazer login.' });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
};

/**
 * Permite ao próprio usuário atualizar seus dados cadastrais (ex: CPF e Telefone após login social)
 */
exports.updateProfile = async (req, res) => {
    const { nome, cpf, telefone, consentimentoAceiteEm } = req.body;
    const userId = req.user.id || req.user._id;

    try {
        if (!nome) {
            return res.status(400).json({ success: false, error: 'Nome é obrigatório.' });
        }
        if (!cpf || !/^\d{3}\.\d{3}\.\d{3}-\d{2}$/.test(cpf)) {
            return res.status(400).json({ success: false, error: 'CPF inválido. Use o formato 000.000.000-00.' });
        }
        if (!telefone || !/^\(\d{2}\) \d{4,5}-\d{4}$/.test(telefone)) {
            return res.status(400).json({ success: false, error: 'Telefone inválido. Use o formato (00) 00000-0000.' });
        }

        // Verifica duplicidade de CPF em outro usuário
        const existingCpf = await Usuario.findOne({ cpf, _id: { $ne: userId } });
        if (existingCpf) {
            return res.status(400).json({ success: false, error: 'Este CPF já está cadastrado por outro usuário.' });
        }

        const updateData = { nome, cpf, telefone };
        if (consentimentoAceiteEm) {
            updateData.consentimentoAceiteEm = new Date();
        }

        const user = await Usuario.findByIdAndUpdate(userId, {
            $set: updateData
        }, { new: true }).lean();

        if (!user) return res.status(404).json({ success: false, error: 'Usuário não encontrado.' });

        const { senha, loginAttempts, __v, ...safeUser } = user;
        if (!safeUser.id) safeUser.id = String(user._id);

        res.json({ success: true, user: safeUser });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
};
