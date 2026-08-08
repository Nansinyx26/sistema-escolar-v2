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
const Usuario = require('../models/Usuario');
const { logAction } = require('../utils/auditHelper');
const ACTUAL_JWT_SECRET = require('../utils/jwtConfig');
const jwt = require('jsonwebtoken');
const { validarPreAuthToken, limparPreAuthToken } = require('../utils/preAuthToken');
const logger = require('../utils/logger');
const { mascarar: mascararEmail } = require('../services/EnvioEmail');

// Força bruta de 6 dígitos: 5 tentativas e o código é invalidado.
const MAX_TENTATIVAS_2FA = 5;
const BLOQUEIO_2FA_MS = 15 * 60 * 1000;

// O transporte de e-mail vive em services/EnvioEmail.js. Este arquivo mantinha
// a QUARTA cópia de `createTransport` do projeto, com defaults próprios — era
// assim que uma correção de configuração passava a valer em três lugares e não
// no quarto.

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
    // Não abre canal externo em testes (evita handles pendentes / flakiness)
    if (process.env.NODE_ENV === 'test') return { ok: true, etapa: 'concluido' };

    const { enviarEmail } = require('../services/EnvioEmail');
    // O nome vem do cadastro e ia cru para dentro do HTML da mensagem.
    const nomeSeguro = require('../utils/sanitize').sanitizeInput(String(nome || 'usuário'));
    // Devolve o resultado em vez de lançar: quem chama precisa poder DIZER ao
    // usuário que o envio falhou, e não fingir que deu certo.
    return enviarEmail(
        email,
        'Seu código de verificação — Sistema Escolar',
        `
            <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px; border: 1px solid #e0e0e0; border-radius: 8px;">
                <h2 style="color: #1a56db; margin-bottom: 8px;">Verificação de Dois Fatores</h2>
                <p>Olá, <strong>${nomeSeguro}</strong>.</p>
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
    );
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
            return res.status(401).json({ success: false, ok: false, codigo: 'PREAUTH_INVALIDO', error: pre.error });
        }
        const userId = pre.userId;

        const usuario = await Usuario.findById(userId)
            .select('+twoFactorEnabled +twoFactorPendingToken +twoFactorPendingExpiry');

        if (!usuario) {
            return res.status(404).json({ success: false, error: 'Usuário não encontrado.' });
        }

        // Mesma fonte de verdade do login (utils/politica2FA.js). Duas copias
        // da regra divergiriam, e a divergencia apareceria como "o login nao
        // pede codigo mas o reenvio insiste que 2FA esta ativo".
        const exige2FA = require('../utils/politica2FA').exigeSegundoFator(usuario);
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

        // Falta de e-mail no cadastro é a falha mais silenciosa do fluxo: o
        // envio para `undefined` é recusado pelo provedor e, no caminho antigo,
        // ninguém ficava sabendo — a tela dizia "código enviado" do mesmo jeito.
        if (!usuario.email || !usuario.email.includes('@')) {
            logger.error('[2FA] Conta sem e-mail válido no cadastro', {
                usuarioId: String(usuario._id), perfil: usuario.perfil,
                action: 'auth.2fa.semEmail',
            });
            return res.status(422).json({
                success: false, ok: false, codigo: 'SEM_EMAIL_CADASTRADO',
                error: 'Esta conta não tem um e-mail válido cadastrado. Fale com o administrador.'
            });
        }

        const envio = await enviarEmail2FA(usuario.email, usuario.nome, codigo);
        const destinoMascarado = mascararEmail(usuario.email);

        if (!envio.ok) {
            // 502: a falha é do canal de entrega, não da requisição. O código
            // segue válido no banco, então um retry entrega sem refazer o login.
            return res.status(502).json({
                success: false, ok: false, codigo: 'FALHA_ENVIO_EMAIL',
                canal: 'email', destinoMascarado,
                error: 'Não foi possível enviar o código agora. Tente novamente em instantes.'
            });
        }

        return res.json({
            success: true,
            ok: true,
            canal: 'email',
            destinoMascarado,
            message: `Código de 6 dígitos enviado para ${destinoMascarado}`
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
            return res.status(401).json({ success: false, ok: false, codigo: 'PREAUTH_INVALIDO', error: pre.error });
        }
        const userId = pre.userId;

        const { codigo } = req.body;
        if (!codigo) {
            return res.status(400).json({ success: false, ok: false, codigo: 'CODIGO_AUSENTE', error: 'O código é obrigatório.' });
        }

        const usuario = await Usuario.findById(userId)
            .select('+twoFactorPendingToken +twoFactorPendingExpiry +twoFactorFixedCode +twoFactorAttempts +twoFactorLockUntil +twoFactorBackupCodes');

        if (!usuario) {
            return res.status(404).json({ success: false, error: 'Usuário não encontrado.' });
        }

        const now = new Date();

        // 2. Bloqueio por tentativas: 10^6 códigos só são varridos sem limite.
        if (usuario.twoFactorLockUntil && usuario.twoFactorLockUntil > now) {
            const minutos = Math.ceil((usuario.twoFactorLockUntil - now) / 60000);
            res.set('Retry-After', String(Math.ceil((usuario.twoFactorLockUntil - now) / 1000)));
            return res.status(429).json({
                success: false,
                ok: false,
                codigo: 'MUITAS_TENTATIVAS',
                retryEmSegundos: Math.ceil((usuario.twoFactorLockUntil - now) / 1000),
                error: `Muitas tentativas incorretas. Tente novamente em ${minutos} minuto(s).`
            });
        }

        // ============================================
        // 3. CÓDIGO DE BACKUP — caminho que não depende do e-mail
        // ============================================
        // Verificado ANTES da expiração do código por e-mail de propósito: o
        // motivo de existir é justamente o cenário em que nenhum código foi
        // enviado (provedor fora do ar, conta sem e-mail válido). Se ficasse
        // depois, o `return` da expiração cortaria o caminho antes de chegar
        // aqui — e o recurso de recuperação não funcionaria exatamente quando
        // é necessário.
        //
        // O bloqueio por tentativas (passo 2, acima) continua valendo: o código
        // de backup não é uma porta que escapa do limite de força bruta.
        const backup = require('../utils/codigosBackup');
        if (backup.pareceCodigoBackup(codigo) && (usuario.twoFactorBackupCodes || []).length) {
            const lote = usuario.twoFactorBackupCodes.map((c) => ({ hash: c.hash, usadoEm: c.usadoEm }));
            const indice = await backup.conferir(codigo, lote);

            if (indice >= 0) {
                // USO ÚNICO: marca o consumo pelo índice exato, com uma escrita
                // condicionada a ele ainda estar livre. Duas requisições
                // simultâneas com o mesmo código não podem passar as duas.
                const campo = `twoFactorBackupCodes.${indice}.usadoEm`;
                const consumo = await Usuario.updateOne(
                    { _id: userId, [campo]: null },
                    { $set: { [campo]: new Date(), twoFactorAttempts: 0, twoFactorLockUntil: null, ultimoLogin: new Date() } }
                );

                if (consumo.modifiedCount !== 1) {
                    // Perdeu a corrida: o código foi consumido por outra
                    // requisição no intervalo. Trata como inválido.
                    return res.status(401).json({
                        success: false, ok: false, codigo: 'CODIGO_INVALIDO',
                        error: 'Código inválido.'
                    });
                }

                const restantes = usuario.twoFactorBackupCodes.filter((c, i) => !c.usadoEm && i !== indice).length;

                limparPreAuthToken(res);
                require('../utils/sessionToken').emitirTokenSessao(res, usuario);
                if (req.session) {
                    req.session.usuarioId = String(usuario._id);
                    if (req.session.escolaPendenteId) {
                        req.session.escolaAtivaId = req.session.escolaPendenteId;
                        delete req.session.escolaPendenteId;
                    }
                }

                // Uso de código de backup é evento de auditoria por si só: ele
                // indica que o canal normal falhou, ou que alguém entrou por um
                // caminho de exceção.
                await logAction(req, 'LOGIN_2FA_BACKUP', 'Segurança', {
                    recursoId: usuario._id,
                    descricao: `Login com código de backup (${restantes} restantes) — ${usuario.email}`
                });
                logger.warn('[2FA] Login com código de backup', {
                    usuarioId: String(usuario._id), perfil: usuario.perfil, restantes,
                    action: 'auth.2fa.backupUsado',
                });

                return res.json({
                    success: true, ok: true,
                    usouCodigoBackup: true,
                    codigosBackupRestantes: restantes,
                    aviso: restantes === 0
                        ? 'Este era o seu último código de backup. Peça ao administrador um lote novo.'
                        : `Você usou um código de backup. Restam ${restantes}.`,
                    redirect_to: require('./UserController').getRedirectPath(usuario),
                });
            }
            // Não bateu: cai no fluxo normal, que contabiliza a tentativa
            // errada e aplica o bloqueio.
        }

        // 4. Expiração SEMPRE aplicada — inclusive quando existe código fixo.
        //    Antes, twoFactorFixedCode pulava a checagem e o login gravava uma
        //    validade de 1 ano, deixando o código eternamente utilizável.
        if (!usuario.twoFactorPendingExpiry || now > usuario.twoFactorPendingExpiry) {
            return res.status(401).json({ success: false, ok: false, codigo: 'CODIGO_INVALIDO', error: 'Código expirado. Solicite um novo.' });
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
                res.set('Retry-After', String(Math.ceil(BLOQUEIO_2FA_MS / 1000)));
                return res.status(429).json({
                    success: false,
                    ok: false,
                    codigo: 'MUITAS_TENTATIVAS',
                    retryEmSegundos: Math.ceil(BLOQUEIO_2FA_MS / 1000),
                    error: 'Muitas tentativas incorretas. O código foi invalidado — faça login novamente.'
                });
            }
            return res.status(401).json({ success: false, ok: false, codigo: 'CODIGO_INVALIDO', error: 'Código inválido.' });
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

        // Gera e seta o cookie JWT pelo emissor central: garante `jti` (sem ele
        // o logout não consegue revogar esta sessão) e as MESMAS opções de
        // cookie usadas no UserController.
        require('../utils/sessionToken').emitirTokenSessao(res, usuario);

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
