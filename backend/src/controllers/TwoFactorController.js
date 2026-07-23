/**
 * TwoFactorController.js
 * ============================================
 * IMPLEMENTAÇÍO: Autenticação de Dois Fatores (2FA) — Roadmap #1
 * ============================================
 * Estratégia: Token de 6 dígitos enviado por e-mail (sem app externo).
 * Simples, compatível com a infraestrutura de e-mail já existente.
 *
 * Fluxo:
 *   1. Usuário faz login com email+senha → sucesso → se tiver 2FA ativo,
 *      retorna { requires2FA: true } em vez de setar o cookie JWT.
 *   2. Frontend exibe campo para digitar o código.
 *   3. POST /api/auth/2fa/verify → valida o código → seta cookie JWT.
 *
 * Rotas necessárias (adicionar em api.js):
 *   POST /api/auth/2fa/send    → envia código (requer pre-auth token)
 *   POST /api/auth/2fa/verify  → valida código e completa login
 *   POST /api/auth/2fa/enable  → ativa 2FA para a conta (requer auth completo)
 *   POST /api/auth/2fa/disable → desativa 2FA (requer auth completo)
 */

const crypto = require('crypto');
const nodemailer = require('nodemailer');
const Usuario = require('../models/Usuario');
const { logAction } = require('../utils/auditHelper');
const ACTUAL_JWT_SECRET = require('../utils/jwtConfig');
const jwt = require('jsonwebtoken');
const { validarPreAuthToken, limparPreAuthToken } = require('../utils/preAuthToken');

// Força bruta de 6 dígitos: 5 tentativas e o código é invalidado.
const MAX_TENTATIVAS_2FA = 5;
const BLOQUEIO_2FA_MS = 15 * 60 * 1000;

// Reutiliza as mesmas configurações de e-mail do UserController
const isResend = !process.env.EMAIL_HOST || process.env.EMAIL_HOST === 'smtp.resend.com';
const transporter = nodemailer.createTransport({
    host: process.env.EMAIL_HOST || 'smtp.resend.com',
    port: parseInt(process.env.EMAIL_PORT) || (isResend ? 465 : 587),
    secure: isResend,
    auth: {
        user: isResend ? 'resend' : process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
});

// --------------------------------------------------
// Utilitário: Gera código numérico de 6 dígitos
// --------------------------------------------------
function gerarCodigo6Digitos() {
    const buffer = crypto.randomBytes(4);
    const numero = buffer.readUInt32BE(0) % 1000000;
    return numero.toString().padStart(6, '0');
}

// --------------------------------------------------
// Utilitário: Envia e-mail com o código 2FA
// --------------------------------------------------
async function enviarEmail2FA(email, nome, codigo) {
    // Não abre SMTP real em testes (evita handles pendentes / flakiness)
    if (process.env.NODE_ENV === 'test') return;
    await transporter.sendMail({
        from: process.env.EMAIL_FROM || `"Sistema Escolar" <noreply@escola.com>`,
        to: email,
        subject: '🔐 Seu código de verificação — Sistema Escolar',
        html: `
            <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px; border: 1px solid #e0e0e0; border-radius: 8px;">
                <h2 style="color: #1a56db; margin-bottom: 8px;">Verificação de Dois Fatores</h2>
                <p>Olá, <strong>${nome}</strong>.</p>
                <p>Seu código de acesso é:</p>
                <div style="font-size: 36px; font-weight: bold; letter-spacing: 8px; color: #111; background: #f4f4f4; padding: 16px 24px; border-radius: 6px; text-align: center; margin: 16px 0;">
                    ${codigo}
                </div>
                <p style="color: #666; font-size: 14px;">Este código expira em <strong>5 minutos</strong>. Não compartilhe com ninguém.</p>
                <p style="color: #666; font-size: 14px;">Se você não solicitou este código, ignore este e-mail.</p>
                <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
                <p style="color: #aaa; font-size: 12px;">Sistema Escolar — E-mail automático, não responda.</p>
            </div>
        `
    });
}

// --------------------------------------------------
// POST /api/auth/2fa/send
// Envia o código 2FA para o e-mail do usuário.
// Chamado pelo UserController logo após validar email+senha,
// quando o usuário tem twoFactorEnabled = true.
// --------------------------------------------------
exports.sendCode = async (req, res) => {
    try {
        // SEGURANÇA: o alvo vem do token de pré-autenticação, nunca de um
        // userId arbitrário no corpo — senão qualquer um dispara códigos
        // (e reinicia o contador de tentativas) na conta que quiser.
        const pre = validarPreAuthToken(req);
        if (!pre.ok) {
            return res.status(401).json({ success: false, error: pre.error });
        }
        const userId = pre.userId;

        const usuario = await Usuario.findById(userId)
            .select('+twoFactorEnabled +twoFactorPendingToken +twoFactorPendingExpiry');

        if (!usuario) {
            return res.status(404).json({ success: false, error: 'Usuário não encontrado.' });
        }

        const exige2FA = usuario.twoFactorEnabled || ['diretor', 'secretaria'].includes(usuario.perfil);
        if (!exige2FA) {
            return res.status(400).json({ success: false, error: '2FA não está ativo nesta conta.' });
        }

        const codigo = gerarCodigo6Digitos();
        const expiry = new Date(Date.now() + 5 * 60 * 1000); // 5 minutos

        // Salva o hash do código (não o código em texto puro)
        const codigoHash = crypto.createHash('sha256').update(codigo).digest('hex');

        await Usuario.findByIdAndUpdate(userId, {
            twoFactorPendingToken: codigoHash,
            twoFactorPendingExpiry: expiry,
            twoFactorAttempts: 0
        });

        await enviarEmail2FA(usuario.email, usuario.nome, codigo);

        console.log(`📧 [2FA] Código enviado para ${usuario.email}`);

        return res.json({
            success: true,
            message: `Código de 6 dígitos enviado para ${usuario.email.replace(/(.{2})(.*)(@.*)/, '$1***$3')}`
        });

    } catch (err) {
        console.error('[2FA] Erro ao enviar código:', err);
        return res.status(500).json({ success: false, error: 'Erro ao enviar código 2FA.' });
    }
};

// --------------------------------------------------
// POST /api/auth/2fa/verify
// Valida o código 2FA e completa o login (seta cookie JWT).
// --------------------------------------------------
exports.verifyCode = async (req, res) => {
    try {
        // 1. Prova de que a senha foi validada nesta sessão de login.
        const pre = validarPreAuthToken(req);
        if (!pre.ok) {
            return res.status(401).json({ success: false, error: pre.error });
        }
        const userId = pre.userId;

        const { codigo } = req.body;
        if (!codigo) {
            return res.status(400).json({ success: false, error: 'O código é obrigatório.' });
        }

        const usuario = await Usuario.findById(userId)
            .select('+twoFactorPendingToken +twoFactorPendingExpiry +twoFactorFixedCode +twoFactorAttempts +twoFactorLockUntil');

        if (!usuario) {
            return res.status(404).json({ success: false, error: 'Usuário não encontrado.' });
        }

        const now = new Date();

        // 2. Bloqueio por tentativas: 10^6 códigos só são varridos sem limite.
        if (usuario.twoFactorLockUntil && usuario.twoFactorLockUntil > now) {
            const minutos = Math.ceil((usuario.twoFactorLockUntil - now) / 60000);
            return res.status(429).json({
                success: false,
                error: `Muitas tentativas incorretas. Tente novamente em ${minutos} minuto(s).`
            });
        }

        // 3. Expiração SEMPRE aplicada — inclusive quando existe código fixo.
        //    Antes, twoFactorFixedCode pulava a checagem e o login gravava uma
        //    validade de 1 ano, deixando o código eternamente utilizável.
        if (!usuario.twoFactorPendingExpiry || now > usuario.twoFactorPendingExpiry) {
            return res.status(401).json({ success: false, error: 'Código expirado. Solicite um novo.' });
        }

        // Compara hash (proteção contra timing attacks via crypto.timingSafeEqual)
        const codigoHash = crypto.createHash('sha256').update(String(codigo).trim()).digest('hex');
        const hashEsperado = usuario.twoFactorPendingToken || '';

        let valido = false;
        try {
            const hashBuf = Buffer.from(codigoHash, 'hex');
            const esperadoBuf = Buffer.from(hashEsperado.padEnd(codigoHash.length, '0'), 'hex');
            valido = hashBuf.length === esperadoBuf.length && crypto.timingSafeEqual(hashBuf, esperadoBuf) && codigoHash === hashEsperado;
        } catch (e) {
            valido = false;
        }

        if (!valido) {
            const tentativas = (usuario.twoFactorAttempts || 0) + 1;
            const update = { twoFactorAttempts: tentativas };

            if (tentativas >= MAX_TENTATIVAS_2FA) {
                // Invalida o código atual junto com o bloqueio: reiniciar o
                // fluxo exige um código novo, não só esperar o tempo passar.
                update.twoFactorLockUntil = new Date(Date.now() + BLOQUEIO_2FA_MS);
                update.twoFactorAttempts = 0;
                update.twoFactorPendingToken = null;
                update.twoFactorPendingExpiry = null;
            }

            await Usuario.findByIdAndUpdate(userId, update);
            await logAction(req, 'LOGIN_2FA_FAILED', 'Auth', {
                recursoId: usuario._id,
                descricao: `Código 2FA incorreto para ${usuario.email} (tentativa ${tentativas}/${MAX_TENTATIVAS_2FA})`
            });

            if (tentativas >= MAX_TENTATIVAS_2FA) {
                return res.status(429).json({
                    success: false,
                    error: 'Muitas tentativas incorretas. O código foi invalidado — faça login novamente.'
                });
            }
            return res.status(401).json({ success: false, error: 'Código inválido.' });
        }

        // Limpa o token pendente e o contador de tentativas
        await Usuario.findByIdAndUpdate(userId, {
            twoFactorPendingToken: null,
            twoFactorPendingExpiry: null,
            twoFactorAttempts: 0,
            twoFactorLockUntil: null,
            ultimoLogin: new Date()
        });

        // O pre-auth é de uso único: consumido, some.
        limparPreAuthToken(res);

        // Gera e seta o cookie JWT com o mesmo nome usado no UserController
        const token = jwt.sign(
            {
                id: usuario._id,
                email: usuario.email,
                perfil: usuario.perfil,
                nome: usuario.nome,
                deveMudarSenha: usuario.deveMudarSenha,
                profileCompleted: !!usuario.profileCompleted,
                // Sem tokenVersion o authJWT invalida o cookie após qualquer troca de senha
                tokenVersion: usuario.tokenVersion || 0
            },
            ACTUAL_JWT_SECRET,
            { expiresIn: '8h' }
        );

        const isProduction = process.env.NODE_ENV === 'production';
        // CORRIGIDO: cookie name 'escola_jwt' (igual ao UserController)
        res.cookie('escola_jwt', token, {
            httpOnly: true,
            secure: isProduction,
            sameSite: 'Lax',
            maxAge: 8 * 60 * 60 * 1000
        });

        // Sessão multi-escola: confirma a escola resolvida no passo de senha
        if (req.session) {
            req.session.usuarioId = String(usuario._id);
            if (req.session.escolaPendenteId) {
                req.session.escolaAtivaId = req.session.escolaPendenteId;
                delete req.session.escolaPendenteId;
            }
        }

        await logAction(req, 'LOGIN_2FA_SUCCESS', 'Auth', {
            recursoId: usuario._id,
            descricao: `Login 2FA concluído para ${usuario.email}`
        });

        // Reusa a mesma tabela de redirecionamento por perfil do login normal
        const { getRedirectPath } = require('./UserController');
        const redirect_to = getRedirectPath(usuario);

        return res.json({
            success: true,
            message: 'Autenticação 2FA concluída.',
            redirect_to,
            usuario: {
                id: usuario._id,
                nome: usuario.nome,
                email: usuario.email,
                perfil: usuario.perfil,
                deveMudarSenha: usuario.deveMudarSenha
            }
        });

    } catch (err) {
        console.error('[2FA] Erro ao verificar código:', err);
        return res.status(500).json({ success: false, error: 'Erro ao verificar código 2FA.' });
    }
};

// --------------------------------------------------
// POST /api/auth/2fa/enable   (requer authJWT)
// Ativa o 2FA para a conta do usuário autenticado.
// --------------------------------------------------
exports.enable = async (req, res) => {
    try {
        const userId = req.user.id;
        const usuario = await Usuario.findById(userId);

        if (!usuario) {
            return res.status(404).json({ success: false, error: 'Usuário não encontrado.' });
        }

        if (usuario.twoFactorEnabled) {
            return res.status(400).json({ success: false, error: '2FA já está ativo.' });
        }

        await Usuario.findByIdAndUpdate(userId, { twoFactorEnabled: true });

        await logAction(req, '2FA_ENABLED', 'Auth', {
            recursoId: userId,
            descricao: `2FA ativado para ${usuario.email}`
        });

        return res.json({ success: true, message: '2FA ativado com sucesso.' });

    } catch (err) {
        console.error('[2FA] Erro ao ativar:', err);
        return res.status(500).json({ success: false, error: 'Erro ao ativar 2FA.' });
    }
};

// --------------------------------------------------
// POST /api/auth/2fa/disable  (requer authJWT)
// Desativa o 2FA para a conta do usuário autenticado.
// --------------------------------------------------
exports.disable = async (req, res) => {
    try {
        const userId = req.user.id;
        const usuario = await Usuario.findById(userId);

        if (!usuario) {
            return res.status(404).json({ success: false, error: 'Usuário não encontrado.' });
        }

        if (!usuario.twoFactorEnabled) {
            return res.status(400).json({ success: false, error: '2FA não está ativo.' });
        }

        await Usuario.findByIdAndUpdate(userId, {
            twoFactorEnabled: false,
            twoFactorSecret: null,
            twoFactorPendingToken: null,
            twoFactorPendingExpiry: null
        });

        await logAction(req, '2FA_DISABLED', 'Auth', {
            recursoId: userId,
            descricao: `2FA desativado para ${usuario.email}`
        });

        return res.json({ success: true, message: '2FA desativado.' });

    } catch (err) {
        console.error('[2FA] Erro ao desativar:', err);
        return res.status(500).json({ success: false, error: 'Erro ao desativar 2FA.' });
    }
};

// --------------------------------------------------
// GET /api/auth/2fa/status    (requer authJWT)
// Retorna se o 2FA está ativo para a conta.
// --------------------------------------------------
exports.status = async (req, res) => {
    try {
        const usuario = await Usuario.findById(req.user.id).select('twoFactorEnabled perfil');

        return res.json({
            success: true,
            twoFactorEnabled: usuario?.twoFactorEnabled || false,
            perfil: usuario?.perfil
        });

    } catch (err) {
        console.error('[2FA] Erro ao consultar status:', err);
        return res.status(500).json({ success: false, error: 'Erro ao consultar status 2FA.' });
    }
};
