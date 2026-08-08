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
const ACTUAL_JWT_SECRET = require('../utils/jwtConfig');
const RecuperacaoSenha = require('../models/RecuperacaoSenha');
const EmailService = require('../services/EmailService');
const logger = require('../utils/logger');
const { emitirParaPerfis } = require('../utils/realtime');
// Usado nos dados vindos do Google, que não passam pela sanitização global
// do app.js (ela cobre req.body/query/params, não payload de OAuth).
const { sanitizeInput } = require('../utils/sanitize');
// Emissão de sessão centralizada: garante `jti` em todo token (pré-requisito
// para o logout conseguir revogar) e opções de cookie idênticas em todo lugar.
const { emitirTokenSessao } = require('../utils/sessionToken');

const SALT_ROUNDS = 12;

function isHashed(senha) {
    return senha && senha.startsWith('$2');
}

/**
 * Cria (ou completa) o perfil da coleção `secretarias` com o vínculo da escola.
 *
 * É esse documento que `vinculosDoUsuario()` lê para resolver req.escolaId no
 * login. Idempotente: se o perfil já existe, apenas garante o vínculo.
 *
 * @param {Object} user documento de Usuario já criado (precisa de escolaId)
 * @param {string} [nomeEscola] nome legível da escola (default: user.escola)
 */
async function criarPerfilSecretaria(user, nomeEscola) {
    const mongoose = require('mongoose');
    const Secretaria = require('../models/Secretaria');
    // Modo legado (nenhuma escola cadastrada ainda): o perfil é criado sem
    // vínculo — filtrarPorEscola segue sem filtro nesse cenário.
    const escolaId = user.escolaId ? String(user.escolaId) : null;
    const email = String(user.email).toLowerCase();

    const existente = await Secretaria.findOne({
        $or: [{ idUsuario: String(user._id) }, { email }]
    });

    if (existente) {
        const jaVinculado = !escolaId || (existente.vinculos || [])
            .some(v => String(v.escolaId) === escolaId);
        if (!jaVinculado) {
            existente.vinculos = [...(existente.vinculos || []), { escolaId, cargo: 'secretaria' }];
            existente.escolaId = escolaId;
            await existente.save();
        }
        return existente;
    }

    return Secretaria.create({
        _id: new mongoose.Types.ObjectId().toString(),
        idUsuario: String(user._id),
        nome: user.nome,
        email,
        telefone: user.telefone,
        escola: nomeEscola || user.escola || undefined,
        escolaId: escolaId || undefined,
        vinculos: escolaId ? [{ escolaId, cargo: 'secretaria' }] : [],
        setor: 'Secretaria Geral',
        cargo: 'Secretário(a)',
        ativo: user.ativo !== false
    });
}

// O transporte de e-mail vive em services/EnvioEmail.js. Este bloco era a
// primeira das cinco cópias de `createTransport` espalhadas pelo projeto; com o
// último `sendMail` daqui migrado, ele ficou sem nenhum uso.

exports.list = async (req, res) => {
    try {
        const filters = {};
        const ALLOWED_FILTERS = ['email', 'perfil', 'ativo', 'nome'];
        // SEGURANÇA: coerção para String — sem isso ?perfil[$ne]=zzz chegava
        // como objeto (express extended:true) e virava um operador Mongo,
        // devolvendo a base inteira de usuários.
        Object.keys(req.query).forEach(key => {
            if (!ALLOWED_FILTERS.includes(key)) return;
            const valor = req.query[key];
            if (valor === null || valor === undefined || typeof valor === 'object') return;
            filters[key] = key === 'ativo' ? String(valor) === 'true' : String(valor);
        });

        // Multi-escola: a lista de contas é isolada por tenant (admin vê tudo)
        const { escolaMatch } = require('../middleware/filtrarPorEscola');
        const escopo = req.user?.perfil === 'admin' ? {} : escolaMatch(req.escolaId);
        const filtroFinal = Object.keys(escopo).length ? { $and: [filters, escopo] } : filters;

        const users = await Usuario.find(filtroFinal).select('-senha').lean();
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

        // MASS ASSIGNMENT / CROSS-TENANT: `Usuario.create(req.body)` gravava o
        // corpo inteiro. Um diretor podia mandar `escolaId` de outra escola
        // (plantando conta em tenant alheio) ou semear campos de controle
        // interno como `tokenVersion`, `emailVerificado` e `lockUntil`.
        // Campos de controle nunca vêm do cliente:
        ['tokenVersion', 'loginAttempts', 'lockUntil', 'anonimizadoEm',
         'emailVerificado', 'emailVerificacaoToken', 'resetToken', 'resetTokenExpiry',
         'twoFactorFixedCode', 'twoFactorSecret', 'twoFactorPendingToken']
            .forEach(campo => { delete req.body[campo]; });

        // Não-admin só cria dentro da própria escola — o escolaId do corpo é
        // ignorado em favor do resolvido pela sessão.
        if (req.user && req.user.perfil !== 'admin') {
            if (!req.escolaId) {
                return res.status(403).json({ success: false, error: 'Escola da sessão não identificada. Faça login novamente.' });
            }
            req.body.escolaId = String(req.escolaId);
        }

        const user = await Usuario.create(req.body);

        // Perfil de equipe + VÍNCULO da escola. Sem este doc, vinculosDoUsuario()
        // devolve [] no login e filtrarPorEscola cai no fallback "escola ativa
        // única" — que numa rede com várias escolas deixa req.escolaId vazio e
        // faz escolaMatch() liberar a rede inteira para a conta nova.
        if (user.perfil === 'secretaria') {
            try {
                await criarPerfilSecretaria(user);
            } catch (e) {
                // A conta de login já existe — não desfaz o cadastro por causa
                // do perfil estendido, só registra para correção manual.
                console.error('[CREATE_USER] Falha ao criar perfil de secretaria:', e.message);
            }
        }

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

        // 2. Verifica se já existe um Usuário (Login) para este professor.
        // `+senha`: o campo é `select: false` no schema; aqui precisamos saber
        // se a conta já tem senha definida (não o valor dela).
        const existingUser = await Usuario.findOne({ email: prof.email.toLowerCase() }).select('+senha');
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

        // Logar automaticamente gerando cookie JWT (mesmo padrão dos demais cadastros)
        emitirTokenSessao(res, user);

        res.json({
            success: true,
            message: 'Conta ativada com sucesso!',
            user: { id: user._id, nome: user.nome, perfil: user.perfil, email: user.email },
            redirect_to: getRedirectPath(user)
        });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
};

/**
 * OPÇÍO B — CADASTRO COM CÓDIGO SECRETO
 */
exports.registerWithCode = async (req, res) => {
    const { nome, email, senha, codigoEscola, cpf, telefone, escolaId } = req.body;

    try {
        if (!senha || senha.length < 8) {
            return res.status(400).json({ success: false, error: 'A senha é obrigatória e deve ter no mínimo 8 caracteres.' });
        }

        // 1. Valida o código secreto e RESOLVE a escola correspondente.
        //    Quando o modal pré-seleciona a escola, `escolaId` garante que o
        //    código digitado é o daquela escola; sem ele, o código identifica
        //    a escola sozinho. `escolaResolvida` = null só no modo legado
        //    (nenhuma escola cadastrada ainda).
        const codeResult = await SecurityController.validateCode(codigoEscola, escolaId || null);
        if (!codeResult) {
            return res.status(403).json({ success: false, error: 'Código Secreto da Escola inválido ou expirado.' });
        }
        const escolaResolvida = codeResult.escola || null;
        const escolaIdFinal = escolaResolvida ? String(escolaResolvida._id) : null;

        // 2. Verifica duplicidade
        const existing = await Usuario.findOne({ email: email.toLowerCase() });
        if (existing) {
            return res.status(400).json({ success: false, error: 'Este e-mail já está cadastrado.' });
        }

        // 3. Cria a conta — já vinculada à escola do código
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
            escola: escolaResolvida ? escolaResolvida.nome : undefined,
            escolaId: escolaIdFinal || undefined,
            emailVerificado: false,
            emailVerificacaoToken,
            emailVerificacaoExpiry: Date.now() + 24 * 60 * 60 * 1000, // 24 horas
            deveMudarSenha: false // usuário não precisa mudar senha no primeiro acesso
        });

        // 3b. Registro na coleção 'professores' com o VÍNCULO da escola. É por
        //     aqui que filtrarPorEscola/vinculosDoUsuario resolve a escola do
        //     professor — sem este doc, o código validado não linkava ninguém.
        //     Perfil estendido (disciplina/turma) é completado depois no painel.
        if (escolaIdFinal) {
            const mongoose = require('mongoose');
            const Professor = require('../models/Professor');
            const jaExiste = await Professor.findOne({
                $or: [{ idUsuario: user._id.toString() }, { email: user.email.toLowerCase() }]
            }).select('_id');
            if (!jaExiste) {
                await Professor.create({
                    _id: new mongoose.Types.ObjectId().toString(),
                    idUsuario: user._id.toString(),
                    nome: user.nome,
                    email: user.email.toLowerCase(),
                    telefone: user.telefone,
                    role: 'professor',
                    ativo: true,
                    escola: escolaResolvida.nome,
                    escolaId: escolaIdFinal,
                    vinculos: [{ escolaId: escolaIdFinal, cargo: 'professor' }]
                });
            }
        }

        // Sessão multi-escola: escola ativa já definida ao entrar no painel
        if (req.session && escolaIdFinal) {
            req.session.escolaAtivaId = escolaIdFinal;
            req.session.usuarioId = String(user._id);
        }

        await logAction(req, 'REGISTER_WITH_CODE', 'Usuarios', {
            recursoId: user._id,
            escolaId: escolaIdFinal || undefined,
            descricao: `Nova conta criada via Código Secreto por ${email}${escolaResolvida ? ` (escola: ${escolaResolvida.nome})` : ''}`
        });

        // Gera token JWT e define cookie HttpOnly.
        // CPF e telefone saíram do payload: o JWT é apenas assinado, NÍO é
        // cifrado — qualquer um que o obtenha lê o conteúdo em claro. Não há
        // motivo para carregar PII num crachá de autorização.
        emitirTokenSessao(res, user);

        // 4. Envia e-mail de verificação em background (não bloqueante)
        const tokenUrl = `${process.env.FRONTEND_URL || 'http://localhost:3001'}/api/auth/verify-email/${emailVerificacaoToken}`;
        notificarVerificacaoEmail(user.email, user.nome, tokenUrl).catch(err => {
            console.error('Erro ao enviar e-mail de verificação em background:', err);
        });

        // Responde indicando sucesso e que o usuário já está autenticado
        res.status(201).json({
            success: true,
            message: 'Conta criada e autenticada com sucesso! Redirecionando...',
            user: { id: user._id, nome: user.nome, perfil: user.perfil, email: user.email },
            redirect_to: getRedirectPath(user)
        });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
};

// IMPORTANTE: os paths devem existir de verdade no servidor estático.
// As páginas do sistema vivem em /html/*; um path como '/dashboard.html' (raiz)
// cai no catch-all do Express e devolve a landing page — causa histórica do
// bug "voltar para a página inicial" após login/cadastro.
function getRedirectPath(user) {
    if (!user) return '/html/login.html';
    if (user.deveMudarSenha) return '/html/mudar-senha.html';
    if (user.perfil === 'responsavel') return '/portal-responsavel/dist/index.html';
    if (user.perfil === 'secretaria') return '/html/secretaria/painel.html';
    if (!user.perfil) return '/html/escolher-perfil.html';
    // admin, diretor e professor usam o dashboard unificado (adapta-se ao perfil)
    return '/html/dashboard.html';
}
exports.getRedirectPath = getRedirectPath;

// ============================================
// ANTI-ENUMERAÇÃO DE USUÁRIO
// ============================================
// Toda falha de login devolve EXATAMENTE esta mensagem e este status. Antes
// havia dois textos distintos — 'Credenciais inválidas ou conta inativa'
// (usuário inexistente/desativado) e 'Credenciais inválidas' (senha errada) —
// o que permitia validar e-mails em massa sem nunca acertar uma senha.
// ============================================
// CONTRATO DE RESPOSTA DO LOGIN — o front reage a `codigo`, nunca ao texto
// ============================================
// O cliente discriminava os casos pelo TEXTO de `error`. Isso torna a mensagem
// parte da API: mudar "E-mail ou senha incorretos." para "Credenciais
// inválidas." quebraria o front sem quebrar nenhum teste, e traduzir a
// interface seria impossível sem quebrar a lógica.
//
// `codigo` é o campo estável. `ok` é alias de `success` e `error` continua
// existindo — os dois mantêm compatibilidade com todas as telas que já leem
// `data.success` / `data.error` hoje; nada precisa migrar de uma vez.
const CODIGOS_LOGIN = {
    CREDENCIAL_INVALIDA: 'CREDENCIAL_INVALIDA',
    MUITAS_TENTATIVAS: 'MUITAS_TENTATIVAS',
    ESCOLA_INDISPONIVEL: 'ESCOLA_INDISPONIVEL',
    SEM_VINCULO_ESCOLA: 'SEM_VINCULO_ESCOLA',
};

const ERRO_CREDENCIAIS = {
    success: false,
    ok: false,
    codigo: CODIGOS_LOGIN.CREDENCIAL_INVALIDA,
    error: 'E-mail ou senha incorretos.',
};

/** Mascara o e-mail para exibição: renan@dominio.com → re***@dominio.com */
function mascararEmail(email) {
    if (typeof email !== 'string') return '';
    return email.replace(/(.{2})(.*)(@.*)/, '$1***$3');
}

/**
 * Corpo do e-mail com o código 2FA.
 *
 * O nome é escapado: ele vem do cadastro e ia direto para dentro do HTML.
 * Quem controla o próprio nome controlaria a marcação da mensagem que a
 * instituição envia em seu nome.
 */
function montarHtmlCodigo2FA(nome, codigo) {
    const nomeSeguro = sanitizeInput(String(nome || 'usuário'));
    return `<div style="font-family:Arial,sans-serif;max-width:480px;padding:24px;border:1px solid #e0e0e0;border-radius:8px;">
        <h2 style="color:#1a56db;">Verificação em Dois Fatores</h2>
        <p>Olá, <strong>${nomeSeguro}</strong>!</p>
        <p>Seu código de acesso:</p>
        <div style="font-size:36px;font-weight:bold;letter-spacing:8px;background:#f4f4f4;padding:16px 24px;border-radius:6px;text-align:center;margin:16px 0;">${codigo}</div>
        <p style="color:#666;font-size:14px;">Válido por <strong>5 minutos</strong>. Não compartilhe.</p>
    </div>`;
}

// Hash bcrypt descartável, usado só para gastar o mesmo tempo de CPU quando a
// conta NÍO existe. Sem isso, "usuário inexistente" responde em ~1ms e
// "senha errada" em ~100ms (custo 12) — um canal lateral de tempo que entrega
// a mesma informação que a mensagem unificada acabou de esconder.
const HASH_DUMMY = bcrypt.hashSync('senha-inexistente-para-timing-constante', SALT_ROUNDS);

exports.login = async (req, res) => {
    const { email, senha } = req.body;

    try {
        // Tipos coeridos: `email` vindo como objeto/array quebraria o
        // toLowerCase() com um 500 que também é um oráculo.
        if (typeof email !== 'string' || typeof senha !== 'string' || !email || !senha) {
            return res.status(401).json(ERRO_CREDENCIAIS);
        }

        // `+senha`: o hash é `select: false` no schema.
        const user = await Usuario.findOne({ email: email.toLowerCase() }).select('+senha');

        if (!user || !user.ativo) {
            // Gasta o tempo de um bcrypt.compare real antes de responder.
            await bcrypt.compare(senha, HASH_DUMMY);
            return res.status(401).json(ERRO_CREDENCIAIS);
        }

        // ============================================
        // SEGURANÇA: SOMENTE bcrypt. O caminho legado foi REMOVIDO.
        // ============================================
        // Antes, uma senha não-hasheada caía num `user.senha === senha`:
        //   1. comparação de string comum, não constant-time;
        //   2. aceitava como válido um valor lido direto do banco — quem
        //      obtivesse leitura do Mongo (backup, dump, injection) logava sem
        //      quebrar hash nenhum;
        //   3. e a "migração automática" só disparava para quem ACERTASSE a
        //      senha, então uma conta legada nunca acessada ficava exposta
        //      indefinidamente esperando o atacante chegar primeiro.
        // Agora: sem hash bcrypt, não há login. As contas legadas restantes
        // devem ser convertidas com `node scripts/migrar-senhas-bcrypt.js`,
        // ou o usuário passa pela recuperação de senha.
        let valid = false;
        if (isHashed(user.senha)) {
            valid = await bcrypt.compare(senha, user.senha);
        } else {
            // Gasta o mesmo tempo do caminho normal: responder rápido aqui
            // distinguiria "conta com senha legada" de "senha errada".
            await bcrypt.compare(senha, HASH_DUMMY);
            valid = false;
            console.warn(`🔐 [SECURITY] Login barrado: conta ${user.email} sem hash bcrypt. Rode scripts/migrar-senhas-bcrypt.js.`);
            await logAction(req, 'LOGIN_BLOCKED_LEGACY_HASH', 'Segurança', {
                recursoId: user._id,
                descricao: `Login bloqueado: senha de ${user.email} não está em bcrypt.`
            });
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
            } else {
                await Usuario.updateOne({ _id: user._id }, { $set: updateData });
            }

            await logAction(req, 'LOGIN_FAILED', 'Auth', { descricao: `Tentativa de login falha para: ${email}` });
            // Mesma resposta do caso "conta não existe" — inclusive quando o
            // bloqueio acabou de ser aplicado. Um 403 'conta bloqueada' aqui
            // confirmaria a existência da conta com 5 requests e senha errada.
            return res.status(401).json(ERRO_CREDENCIAIS);
        }

        // ============================================
        // BLOQUEIO POR BRUTE FORCE — verificado DEPOIS da senha, de propósito.
        // Quando a checagem vinha antes, a resposta 'Conta bloqueada' era um
        // oráculo de existência: qualquer um descobria contas válidas mandando
        // 5 senhas erradas e lendo o 403. Agora só quem apresenta a senha
        // CORRETA descobre que a conta está bloqueada — e quem tem a senha
        // correta já não precisa desse oráculo.
        // ============================================
        if (user.lockUntil && user.lockUntil > Date.now()) {
            const restanteMs = user.lockUntil - Date.now();
            const minutosRestantes = Math.ceil(restanteMs / (60 * 1000));
            // 429 (e não 403): o bloqueio é limitação de TAXA, não falta de
            // permissão. `Retry-After` é o cabeçalho padrão para isso e permite
            // ao cliente esperar sem inventar heurística em cima do texto.
            const retryEmSegundos = Math.ceil(restanteMs / 1000);
            res.set('Retry-After', String(retryEmSegundos));
            return res.status(429).json({
                success: false,
                ok: false,
                codigo: CODIGOS_LOGIN.MUITAS_TENTATIVAS,
                retryEmSegundos,
                error: `Conta bloqueada temporariamente devido a múltiplas tentativas falhas. Tente novamente em ${minutosRestantes} minutos.`
            });
        }

        // Login bem sucedido: Reseta tentativas via updateOne (bypass validation)
        await Usuario.updateOne({ _id: user._id }, {
            $set: { loginAttempts: 0 },
            $unset: { lockUntil: '' }
        });

        // ============================================
        // MULTI-ESCOLA: resolve a escola ativa ANTES do redirect.
        // - ?escolaId (clique no modal): exige vínculo → 403 se não tiver;
        // - 1 vínculo → usa automaticamente;
        // - múltiplos → devolve a lista para o seletor do frontend;
        // - sem vínculos (legado/admin/responsável) → segue; o middleware
        //   filtrarPorEscola resolve pelo fallback (escola ativa única).
        // ============================================
        let escolaAtivaId = null;
        try {
            const { vinculosDoUsuario } = require('../middleware/filtrarPorEscola');
            const Escola = require('../models/Escola');
            const escolaIdSolicitada = req.body.escolaId || null;
            const vinculos = await vinculosDoUsuario({ id: user._id, email: user.email, perfil: user.perfil });

            if (escolaIdSolicitada) {
                const escolaSolicitada = await Escola.findById(escolaIdSolicitada).select('nome ativo').lean().catch(() => null);
                if (!escolaSolicitada || !escolaSolicitada.ativo) {
                    return res.status(403).json({
                        success: false, ok: false,
                        codigo: CODIGOS_LOGIN.ESCOLA_INDISPONIVEL,
                        error: 'Esta escola ainda não está disponível no sistema.'
                    });
                }
                const temVinculo = user.perfil === 'admin'
                    || vinculos.some(v => String(v.escolaId) === String(escolaIdSolicitada));
                if (!temVinculo) {
                    return res.status(403).json({
                        success: false, ok: false,
                        codigo: CODIGOS_LOGIN.SEM_VINCULO_ESCOLA,
                        error: `Você não possui vínculo com a escola "${escolaSolicitada.nome}". Verifique com a direção da escola.`
                    });
                }
                escolaAtivaId = String(escolaIdSolicitada);
            } else if (vinculos.length === 1) {
                escolaAtivaId = String(vinculos[0].escolaId);
            } else if (vinculos.length > 1) {
                const escolas = await Escola.find({ _id: { $in: vinculos.map(v => v.escolaId) }, ativo: true })
                    .select('nome tipo bairro').lean();
                if (escolas.length > 1) {
                    return res.json({
                        success: true,
                        ok: true,
                        requiresEscolha: true,
                        escolas,
                        message: 'Você possui vínculo com mais de uma escola. Selecione em qual deseja entrar.'
                    });
                }
                if (escolas.length === 1) escolaAtivaId = String(escolas[0]._id);
            }
        } catch (e) {
            console.error('[LOGIN] Falha na resolução multi-escola (seguindo sem contexto):', e.message);
        }

        // ============================================
        // MELHORIA: Verificação 2FA — Roadmap #1
        // Se o usuário tiver 2FA ativo, NÍO emite o cookie JWT ainda.
        // Dispara o envio do código e retorna requires2FA=true.
        // O frontend exibirá a tela de código; o cookie só é setado em /api/auth/2fa/verify.
        // ============================================
        const redirect_to = getRedirectPath(user);
        // Seleciona campos extras necessários para o fluxo 2FA
        const userWith2FA = await Usuario.findById(user._id).select('+twoFactorEnabled +twoFactorFixedCode +twoFactorPendingToken +twoFactorPendingExpiry');
        // Política do segundo fator: utils/politica2FA.js (fonte única).
        // A regra estava hardcoded aqui e duplicada no TwoFactorController.
        const politica2FA = require('../utils/politica2FA');
        const precisa2FA = userWith2FA && politica2FA.exigeSegundoFator({
            perfil: user.perfil,
            twoFactorEnabled: userWith2FA.twoFactorEnabled,
        });

        // Dispensa ativa (DISPENSAR_2FA_EMAIL): o login termina aqui mesmo, com
        // sessão completa. Registrado em auditoria porque "quem entrou sem
        // segundo fator, e quando" precisa ter resposta depois.
        if (userWith2FA && !precisa2FA && politica2FA.dispensado(user.perfil)) {
            await logAction(req, 'LOGIN_SEM_2FA', 'Segurança', {
                recursoId: user._id,
                descricao: `Login sem segundo fator (perfil ${user.perfil} dispensado por configuração) — ${user.email}`
            });
            logger.warn('[2FA] Login sem segundo fator — perfil dispensado', {
                perfil: user.perfil, usuarioId: String(user._id), action: 'auth.2faDispensado',
            });
        }

        if (precisa2FA) {
            const { emitirPreAuthToken } = require('../utils/preAuthToken');

            // Se houver um código fixo configurado para esta conta, use-o (não envia e-mail).
            // A validade é a MESMA do fluxo normal (5 min): a expiração de 1 ano
            // transformava o código fixo numa credencial permanente de 6 dígitos.
            if (userWith2FA.twoFactorFixedCode) {
                const codigo = userWith2FA.twoFactorFixedCode;
                const codigoHash = crypto.createHash('sha256').update(codigo).digest('hex');
                const expiry = new Date(Date.now() + 5 * 60 * 1000);

                await Usuario.findByIdAndUpdate(user._id, {
                    twoFactorPendingToken: codigoHash,
                    twoFactorPendingExpiry: expiry,
                    twoFactorAttempts: 0
                });

                console.log(`🔐 [2FA] Código fixo aplicado para ${user.email}`);
                await logAction(req, 'LOGIN_2FA_REQUIRED', 'Auth', {
                    recursoId: user._id,
                    descricao: `Login 2FA (fixo) exigido para ${user.email}`
                });

                if (req.session && escolaAtivaId) req.session.escolaPendenteId = escolaAtivaId;

                // Prova de senha validada — sem ela o /2fa/verify não aceita nada.
                // O _id do usuário NÍO é mais devolvido: era o único "segredo"
                // necessário para atacar o segundo fator direto.
                emitirPreAuthToken(res, user);

                return res.json({
                    success: true,
                    ok: true,
                    requires2FA: true,
                    require2FA: true,          // alias do contrato padronizado
                    canal: 'email',
                    destinoMascarado: mascararEmail(user.email),
                    redirect_to,
                    message: `Código de verificação fixo habilitado para ${mascararEmail(user.email)}`
                });
            }

            // Fluxo padrão: gera código aleatório, salva e envia por e-mail
            const codigo = crypto.randomInt(0, 1000000).toString().padStart(6, '0');
            const codigoHash = crypto.createHash('sha256').update(codigo).digest('hex');
            const expiry = new Date(Date.now() + 5 * 60 * 1000);

            await Usuario.findByIdAndUpdate(user._id, {
                twoFactorPendingToken: codigoHash,
                twoFactorPendingExpiry: expiry,
                twoFactorAttempts: 0
            });

            // ============================================
            // ENVIO AGUARDADO — era aqui que o 2FA sumia
            // ============================================
            // Este bloco era fire-and-forget: `sendMail(...).catch(console.error)`.
            // A resposta HTTP dizia "código enviado" e voltava ANTES de o envio
            // terminar, então uma recusa do provedor (remetente não verificado,
            // porta SMTP bloqueada, chave inválida) virava uma linha de log que
            // ninguém lia — e diretor e secretaria ficavam esperando um e-mail
            // que nunca saiu, sem nenhum erro na tela.
            //
            // Agora o resultado é aguardado e viaja na resposta (`envioConfirmado`),
            // para a tela poder dizer a verdade.
            let envioConfirmado = false;
            if (process.env.NODE_ENV === 'test') {
                // Testes não abrem canal externo: o envio real deixava handles
                // pendentes que o jest --forceExit matava no meio de outra
                // request, tornando a suíte de auth intermitente.
                envioConfirmado = true;
            } else {
                const { enviarEmail } = require('../services/EnvioEmail');
                const resultado = await enviarEmail(
                    user.email,
                    'Código de verificação — Sistema Escolar',
                    montarHtmlCodigo2FA(user.nome, codigo)
                );
                envioConfirmado = resultado.ok;
                if (!resultado.ok) {
                    // O código continua válido no banco: o admin pode reenviar
                    // por /api/auth/2fa/send sem o usuário refazer a senha.
                    logger.error('[2FA] Código gerado mas NÃO entregue', {
                        etapa: resultado.etapa, erro: resultado.erro,
                        action: 'auth.2fa.envioFalhou',
                    });
                }
            }
            await logAction(req, 'LOGIN_2FA_REQUIRED', 'Auth', {
                recursoId: user._id,
                descricao: `Login 2FA exigido para ${user.email}`
            });

            if (req.session && escolaAtivaId) req.session.escolaPendenteId = escolaAtivaId;

            emitirPreAuthToken(res, user);

            return res.json({
                success: true,
                ok: true,
                requires2FA: true,
                require2FA: true,          // alias do contrato padronizado
                canal: 'email',
                destinoMascarado: mascararEmail(user.email),
                envioConfirmado,           // false = o e-mail NAO saiu; a tela avisa
                redirect_to,
                message: envioConfirmado
                    ? `Código de verificação enviado para ${mascararEmail(user.email)}`
                    : 'Não foi possível enviar o código por e-mail agora. Tente novamente ou fale com o administrador.'
            });
        }

        // ============================================
        // SEGURANÇA: Cookie HttpOnly — única forma de armazenar o JWT.
        // O token NÍO é enviado no corpo da resposta JSON (previne roubo via XSS).
        // ============================================
        // Sem 2FA: emite o cookie JWT normalmente
        emitirTokenSessao(res, user);

        // Sessão multi-escola
        if (req.session) {
            req.session.usuarioId = String(user._id);
            if (escolaAtivaId) req.session.escolaAtivaId = escolaAtivaId;
        }

        // Atualiza ultimoLogin apenas aqui (sem 2FA)
        await Usuario.updateOne({ _id: user._id }, { $set: { ultimoLogin: new Date() } });

        res.json({
            success: true,
            ok: true,
            requires2FA: false,
            require2FA: false,
            redirect_to,
            user: {
                id: user._id,
                nome: user.nome,
                perfil: user.perfil,
                // Rótulo de exibição vem do servidor (utils/perfilRotulo.js),
                // não de inferência no front.
                perfilRotulo: require('../utils/perfilRotulo').rotuloDoPerfil(user.perfil),
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
    // SEGURANÇA: rota de simulação — emite JWT só com o e-mail, sem senha.
    // Jamais pode existir fora do ambiente de desenvolvimento.
    if (process.env.NODE_ENV !== 'development') {
        return res.status(404).json({ success: false, error: 'Endpoint não encontrado' });
    }

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

        emitirTokenSessao(res, user || payload, {
            profileCompleted: user ? !!user.profileCompleted : false
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
 * Aceita apenas URL https absoluta de host do Google para a foto de perfil.
 * Qualquer outra coisa vira string vazia (o frontend cai no avatar de iniciais).
 *
 * A CSP já restringe `img-src` aos hosts lh*.googleusercontent.com, então uma
 * URL estranha não CARREGA — mas isso não impede que o valor quebre o atributo
 * no HTML montado por interpolação. A validação aqui trata a segunda metade.
 */
function validarUrlFoto(url) {
    if (!url || typeof url !== 'string') return '';
    try {
        const u = new URL(url);
        if (u.protocol !== 'https:') return '';
        if (!/(^|\.)googleusercontent\.com$/.test(u.hostname)) return '';
        // Aspas/sinais de menor nunca aparecem numa URL legítima do Google e
        // são exatamente o que quebraria `src="..."`.
        if (/["'<>]/.test(url)) return '';
        return url;
    } catch {
        return '';
    }
}

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

        // ============================================
        // SANITIZAÇÃO DE DADOS DE TERCEIRO (Google)
        // ============================================
        // A sanitização global do app.js cobre req.body/query/params. Estes
        // campos NÍO vêm de lá — vêm de dentro do ID token do Google — então
        // chegavam ao banco crus.
        //
        // O nome de exibição de uma conta Google é escolhido livremente pelo
        // dono dela. Um atacante criava uma conta chamada
        // `<img src=x onerror=...>`, logava, e o nome ia parar na notificação
        // de cadastro que a direção lê — XSS armazenado com origem externa,
        // sem passar por nenhum campo de formulário.
        nome = sanitizeInput(String(nome || '')).trim().slice(0, 120);
        if (!nome) nome = email.split('@')[0];

        // A foto vira atributo `src` no frontend. Além de sanitizar, exigimos
        // uma URL https absoluta: sem isso um valor com aspas quebra o atributo
        // e injeta um handler no HTML que a monta.
        picture = validarUrlFoto(picture);

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

        // O TOKEN carrega só o mínimo para autorizar (ver montarPayload).
        // CPF, telefone e consentimento saíram do JWT: ele é assinado, não
        // cifrado — quem tiver o token lê tudo em claro.
        emitirTokenSessao(res, user, { loginGoogle: true });

        // O CORPO da resposta traz o que a UI precisa renderizar — e nada além.
        res.json({
            success: true,
            user: {
                id: user._id,
                perfil: user.perfil,
                email: user.email,
                nome: user.nome,
                fotoGoogle: user.fotoGoogle || '',
                foto: user.foto || '',
                loginGoogle: true,
                profileCompleted: !!user.profileCompleted,
                tutorialProfessorConcluido: !!user.tutorialProfessorConcluido,
                tutorialResponsavelConcluido: !!user.tutorialResponsavelConcluido
            }
        });
    } catch (e) {
        console.error('Erro na validação do Google Token:', e);
        res.status(401).json({ success: false, error: `Autenticação Google falhou: ${e.message}` });
    }
};


exports.logout = async (req, res) => {
    // ============================================
    // REVOGAÇÃO NO SERVIDOR — não basta limpar o cookie.
    // `clearCookie` é só um pedido ao browser; o JWT em si continuava válido
    // pelas 8h restantes e o authJWT também o aceita via header
    // `Authorization: Bearer`. Qualquer cópia do token (proxy, máquina
    // compartilhada, XSS anterior) seguia autenticando após o logout.
    // Agora o `jti` entra na denylist e o token morre de fato.
    // ============================================
    const tokenAtual = req.cookies?.escola_jwt
        || (req.headers.authorization?.startsWith('Bearer ')
            ? req.headers.authorization.slice(7)
            : null);

    try {
        await require('../utils/sessionToken').revogarTokenSessao(tokenAtual);
    } catch (e) {
        // Nunca falha o logout por causa disso — o cookie ainda é limpo abaixo.
        console.error('[LOGOUT] Falha ao revogar token:', e.message);
    }

    // clearCookie precisa das mesmas opções usadas no setCookie, senão o browser ignora.
    // O cookie é emitido com sameSite 'Lax' — usar 'Strict' aqui impedia a limpeza.
    require('../utils/sessionToken').limparCookieSessao(res);
    // Descarta qualquer 2FA em andamento junto com a sessão
    require('../utils/preAuthToken').limparPreAuthToken(res);
    // Encerra também a sessão multi-escola
    if (req.session) {
        req.session.destroy(() => {
            res.clearCookie('escola_sess');
            res.json({ success: true, message: 'Logout realizado com sucesso' });
        });
        return;
    }
    res.json({ success: true, message: 'Logout realizado com sucesso' });
};

/**
 * IDOR CROSS-TENANT: o diretor pode gerenciar secretaria/professor — mas SÓ da
 * própria escola. As checagens de perfil sozinhas ('é diretor?', 'o alvo é
 * professor?') não olhavam a escola: um diretor da Escola A alterava ou
 * excluía a conta de qualquer professor da rede inteira informando o `_id`
 * dele (que vaza em listagens, comunicados e no campo `criadoPor`).
 *
 * `req.escolaId` é resolvido pelo middleware filtrarPorEscola.
 *
 * @returns {boolean} true se o alvo pertence ao tenant de quem chama
 */
function mesmoTenant(req, alvo) {
    if (req.user?.perfil === 'admin') return true;   // admin é global por definição

    // FAIL-CLOSED e deliberado: sem contexto de escola, ou com alvo legado sem
    // `escolaId`, a resposta é NEGAR. A alternativa ("na dúvida, permite")
    // reabriria exatamente o IDOR cross-tenant que este guard existe para
    // fechar — e reabriria justamente nos registros mais antigos, que são os
    // que ninguém revisa.
    //
    // O log existe porque uma negativa silenciosa aqui é indistinguível de um
    // bug para quem está no suporte: sem ele, "o diretor não consegue editar
    // este professor" não tem causa observável. Rode
    // `npm run migrate:multiescola` para preencher os escolaId faltantes.
    if (!req.escolaId) {
        console.warn(`[TENANT] Negado: sessão de ${req.user?.email} sem escolaId resolvido.`);
        return false;
    }
    if (!alvo?.escolaId) {
        console.warn(`[TENANT] Negado: usuário alvo ${alvo?._id} não tem escolaId (registro legado). Rode npm run migrate:multiescola.`);
        return false;
    }
    return String(alvo.escolaId) === String(req.escolaId);
}

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
            // ...e o alvo precisa ser da MESMA escola do diretor.
            if (!mesmoTenant(req, oldData)) {
                return res.status(403).json({ success: false, error: 'Acesso negado. Sem permissão para atualizar esta conta.' });
            }
        }

        const isSelfEdit = String(targetId) === String(callingUserId);
        const isAdmin = callingUserPerfil === 'admin';

        // Whitelist de campos permitidos.
        // SEGURANÇA: campos que decidem privilégio (perfil, ativo, escola) e
        // identidade (email, cpf) NÍO entram na whitelist de auto-edição —
        // sem isso qualquer conta autenticada se promovia a diretor com um
        // PUT /api/usuarios/<próprioId> { "perfil": "diretor" }.
        const CAMPOS_PRIVILEGIO = ['perfil', 'ativo', 'escola', 'email', 'cpf', 'deveMudarSenha'];
        const CAMPOS_PROPRIOS = [
            'nome', 'telefone', 'senha', 'foto', 'disciplina',
            'whatsApp', 'vinculoAluno', 'responsavelPrincipal', 'guardaLegal', 'autorizadoRetirar',
            'segundoResponsavel', 'pessoasAutorizadas', 'lgpdConsents',
            'profileCompleted', 'tutorialProfessorConcluido', 'tutorialResponsavelConcluido',
            'consentimentoAceiteEm', 'consentimentoVersao',
            'preferenciaNarracao', 'voiceSpeed', 'accessibilityFontSize', 'accessibilityContrast', 'accessibilityReadingMode'
        ];

        // Onboarding legado (/html/escolher-perfil.html): uma conta que ainda
        // NÍO tem perfil pode definir o seu. Contas com perfil já definido só
        // são alteradas por admin.
        const podeDefinirPerfilInicial = isSelfEdit && !oldData.perfil;

        const userWhitelist = isAdmin
            ? [...CAMPOS_PROPRIOS, ...CAMPOS_PRIVILEGIO, 'perfilDefinidoEm']
            : isSelfEdit
                ? [...CAMPOS_PROPRIOS, ...(podeDefinirPerfilInicial ? ['perfil', 'perfilDefinidoEm'] : [])]
                // Diretor gerenciando secretaria/professor: pode ativar/desativar, não muda perfil.
                : [...CAMPOS_PROPRIOS, 'ativo'];

        const filteredBody = {};
        userWhitelist.forEach(field => {
            if (req.body[field] !== undefined) filteredBody[field] = req.body[field];
        });

        if (filteredBody.senha && !isHashed(filteredBody.senha)) {
            filteredBody.senha = await bcrypt.hash(filteredBody.senha, SALT_ROUNDS);
        }

        // Proteção: apenas admin muda o perfil de uma conta que já tem perfil
        if (filteredBody.perfil && filteredBody.perfil !== oldData.perfil) {
            if (!isAdmin) {
                if (!podeDefinirPerfilInicial || !['professor', 'diretor'].includes(filteredBody.perfil)) {
                    return res.status(403).json({ success: false, error: 'Você não tem permissão para atribuir este perfil.' });
                }
            }
            // Define a data de definição de perfil automaticamente se não informada
            if (!filteredBody.perfilDefinidoEm) {
                filteredBody.perfilDefinidoEm = new Date();
            }
        }

        // Toda alteração de privilégio/credencial invalida as sessões abertas
        // (o authJWT compara tokenVersion). Sem isso, um usuário demitido ou
        // rebaixado continuava operando com o cookie até expirar (8h).
        const mudouPrivilegio =
            (filteredBody.perfil !== undefined && filteredBody.perfil !== oldData.perfil) ||
            (filteredBody.ativo !== undefined && filteredBody.ativo !== oldData.ativo) ||
            filteredBody.senha !== undefined ||
            (filteredBody.email !== undefined && filteredBody.email !== oldData.email);

        const updateOps = { $set: filteredBody };
        if (mudouPrivilegio) updateOps.$inc = { tokenVersion: 1 };

        const user = await Usuario.findByIdAndUpdate(targetId, updateOps, { new: true }).select('-senha');

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
                // Mesma regra do update: perfil permitido E mesma escola. Sem a
                // segunda metade, um diretor apagava professores de qualquer
                // escola da rede só com o `_id` do alvo.
                if (!isDiretorManagingStaff || !mesmoTenant(req, user)) {
                    return res.status(403).json({ success: false, error: 'Acesso negado. Sem permissão para excluir esta conta.' });
                }
            }

            await logAction(req, 'DELETE_USER', 'Usuarios', {
                recursoId: user._id,
                descricao: `Usuário ${user.email} excluído permanentemente.`
            });
            // Revoga sessões abertas ANTES de remover o documento: se a exclusão
            // falhar no meio, a conta já não consegue mais usar o cookie antigo.
            await Usuario.updateOne({ _id: user._id }, { $inc: { tokenVersion: 1 } });
            await Usuario.findByIdAndDelete(req.params.id);

            // Remove o perfil estendido junto. `secretarias.email` é unique —
            // o órfão impedia recadastrar a mesma pessoa depois.
            if (user.perfil === 'secretaria') {
                const Secretaria = require('../models/Secretaria');
                await Secretaria.deleteOne({
                    $or: [{ idUsuario: String(user._id) }, { email: String(user.email).toLowerCase() }]
                }).catch(e => console.error('[DELETE_USER] Perfil de secretaria órfão:', e.message));
            }
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

        // Senha destruída de forma irrecuperável: bytes aleatórios com hash.
        // Gravar uma string fixa em texto puro deixava o caminho legado de
        // login (comparação direta) a uma única flag de distância.
        const senhaInutilizavel = await bcrypt.hash(crypto.randomBytes(32).toString('hex'), SALT_ROUNDS);

        // Limpa todos os dados sensíveis e revoga as sessões abertas
        await Usuario.findByIdAndUpdate(req.params.id, {
            $set: {
                nome: 'Usuário Anonimizado (LGPD)',
                email: `${idAnonimo}@escola.anon`,
                cpf: '000.000.000-00',
                telefone: '(00) 00000-0000',
                ativo: false,
                senha: senhaInutilizavel,
                ultimoLogin: null
            },
            $inc: { tokenVersion: 1 }
        });

        // As conversas do chat ficavam intactas: anonimizar o cadastro e
        // deixar o texto das mensagens preservava justamente o conteúdo mais
        // pessoal (nomes de alunos, situações familiares).
        //
        // O conteúdo é apagado, o documento permanece. Excluir a mensagem
        // inteira mutilaria a conversa do OUTRO participante — que é registro
        // legítimo da escola e dado dele também.
        const ChatDireto = require('../models/ChatDireto');
        const mensagensAnonimizadas = await ChatDireto.updateMany(
            { remetenteId: String(user._id), apagadaParaTodos: { $ne: true } },
            {
                $set: {
                    mensagem: 'Mensagem removida a pedido do titular (LGPD).',
                    apagadaParaTodos: true
                },
                $unset: { anexo: '', audio: '' }
            }
        );

        // As conversas com o copiloto são EXCLUÍDAS, não esvaziadas.
        //
        // A diferença para o chat interno acima é que ali existe um segundo
        // participante humano, e o documento precisa sobreviver para não mutilar
        // a conversa dele. Aqui o outro lado é o assistente: não há registro de
        // terceiro a preservar, então mantém-se apenas um invólucro vazio sem
        // função — enquanto o texto pode citar nome e nota de aluno.
        const IaConversa = require('../models/IaConversa');
        const conversasRemovidas = await IaConversa.deleteMany({
            usuarioId: String(user._id)
        });

        await logAction(req, 'ANONYMIZE_USER', 'Usuarios', {
            recursoId: user._id,
            descricao: `Dados do usuário ${emailOriginal} foram anonimizados conforme LGPD. `
                + `${mensagensAnonimizadas.modifiedCount} mensagem(ns) do chat tiveram o conteúdo removido. `
                + `${conversasRemovidas.deletedCount} conversa(s) com o assistente foram excluídas.`
        });

        res.json({
            success: true,
            message: 'Usuário anonimizado com sucesso.',
            mensagensAnonimizadas: mensagensAnonimizadas.modifiedCount
        });
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

        // Multi-escola: o responsável pertence à escola do aluno vinculado.
        // (Se o aluno for legado e não tiver escolaId, fica indefinido e o
        //  middleware filtrarPorEscola resolve pela escola ativa em runtime.)
        const escolaIdDoAluno = aluno.escolaId || undefined;

        const now = new Date();
        const user = await Usuario.create({
            nome,
            email: email.toLowerCase(),
            senha: senhaHash,
            telefone,
            perfil: 'responsavel',
            ativo: true,
            escolaId: escolaIdDoAluno,
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
            escolaId: aluno.escolaId || undefined
        });

        // 5. Notificação em Tempo Real (WebSocket)
        // Restrito à direção da escola do aluno: o emit global entregava o
        // nome do responsável e o nome da criança a todos os sockets da rede.
        emitirParaPerfis(aluno.escolaId, ['diretor', 'admin', 'secretaria'], 'new-registration', {
            nome: user.nome,
            perfil: 'Responsável',
            alunoVinculado: aluno.nome,
            data: dateStr,
            horario: hourStr
        });

        // 6. Logar automaticamente gerando cookie JWT
        emitirTokenSessao(res, user);

        res.status(201).json({
            success: true,
            message: `Conta criada com sucesso! Aluno "${aluno.nome}" vinculado automaticamente.`,
            user: { id: user._id, nome: user.nome, perfil: user.perfil, email: user.email },
            redirect_to: getRedirectPath(user)
        });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
};

/**
 * Cadastro público de Docente
 */
exports.registerDocente = async (req, res) => {
    const { nome, email, senha, disciplina, turma, matricula, telefone, codigoEscola, escolaId } = req.body;

    try {
        if (!nome || !email || !senha || !disciplina || !turma || !matricula || !telefone || !codigoEscola) {
            return res.status(400).json({ success: false, error: 'Todos os campos são obrigatórios, incluindo o Código Secreto da Escola.' });
        }

        // Valida o código secreto (por escola quando escolaId presente)
        const SecurityController = require('./SecurityController');
        const codeResult = await SecurityController.validateCode(codigoEscola, escolaId || null);
        if (!codeResult) {
            console.log(`⚠️ [REGISTER-DOCENTE] Código inválido para escolaId=${escolaId || '(auto)'}`);
            return res.status(403).json({ success: false, error: 'Código Secreto da Escola inválido ou expirado. Solicite o código atual à direção da escola.' });
        }
        const escolaResolvida = codeResult.escola || null; // null = modo legado (sem escolas cadastradas)
        const escolaIdFinal = escolaResolvida ? String(escolaResolvida._id) : null;

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
        const materiasEspeciais = ['Inglês', 'Educação Física', 'Artes', 'SEBRAE', 'Oficina de Leitura', 'Of. Maker'];
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
            escola: escolaResolvida ? escolaResolvida.nome : 'default',
            vinculos: escolaIdFinal ? [{ escolaId: escolaIdFinal, cargo: 'professor' }] : [],
            escolaId: escolaIdFinal || undefined
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
            escolaId: escolaIdFinal || undefined
        });

        // 2. Notificação em Tempo Real (WebSocket) — só a direção da escola
        emitirParaPerfis(escolaIdFinal, ['diretor', 'admin', 'secretaria'], 'new-registration', {
            nome: user.nome,
            perfil: 'Docente',
            data: dateStr,
            horario: hourStr
        });

        // 3. Logar automaticamente gerando cookie JWT
        emitirTokenSessao(res, user);

        // Sessão multi-escola: escola ativa já definida ao entrar no painel
        if (req.session && escolaIdFinal) {
            req.session.escolaAtivaId = escolaIdFinal;
            req.session.usuarioId = String(user._id);
        }

        res.status(201).json({
            success: true,
            message: 'Conta de docente criada com sucesso!',
            user: { id: user._id, nome: user.nome, perfil: user.perfil, email: user.email },
            redirect_to: getRedirectPath(user)
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
    const { ttsProvider, voicePreference, elevenlabsVoice, narrarAuto, speed, narrationMode } = req.body;

    // `voiceGender` é campo legado com enum de gênero. A tela de voz hoje manda
    // NOME DE VOZ ('adam', 'brian', ...) ou 'off' — copiar isso direto para lá,
    // com runValidators ligado, reprovava o update inteiro: a pessoa trocava a
    // voz, recebia 500 e NENHUMA das preferências era gravada.
    const GENEROS_LEGADOS = ['male', 'female'];

    try {
        const updateData = {};
        if (ttsProvider)     updateData['settings.ttsProvider']     = ttsProvider;
        if (voicePreference) updateData['settings.voicePreference'] = voicePreference;
        if (elevenlabsVoice) updateData['settings.elevenlabsVoice'] = elevenlabsVoice;
        if (narrarAuto !== undefined) updateData['settings.narrarAuto'] = Boolean(narrarAuto);
        if (speed !== undefined) updateData['settings.speed']       = Number(speed);
        if (narrationMode)   updateData['settings.narrationMode']   = narrationMode;

        // Também atualiza os campos legados para retrocompatibilidade
        if (ttsProvider)     updateData.ttsProvider         = ttsProvider;
        if (GENEROS_LEGADOS.includes(voicePreference)) updateData.voiceGender = voicePreference;
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
    const { nome, email, senha, telefone, escola, codigoEscola, escolaId } = req.body;

    try {
        if (!nome || !email || !senha || !telefone || !codigoEscola) {
            return res.status(400).json({ success: false, error: 'Todos os campos são obrigatórios, incluindo o Código Secreto da Escola.' });
        }

        // 1. Valida o código secreto (por escola quando escolaId presente)
        const SecurityController = require('./SecurityController');
        const codeResult = await SecurityController.validateCode(codigoEscola, escolaId || null);
        if (!codeResult) {
            console.log(`⚠️ [REGISTER-DIRETOR] Código inválido para escolaId=${escolaId || '(auto)'}`);
            return res.status(403).json({ success: false, error: 'Código Secreto da Escola inválido ou expirado. Solicite o código atual à direção da escola.' });
        }
        const escolaResolvida = codeResult.escola || null;
        const escolaIdFinal = escolaResolvida ? String(escolaResolvida._id) : null;

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
            escola: escolaResolvida ? escolaResolvida.nome : (escola || 'default'),
            role: 'director',
            ativo: true,
            vinculos: escolaIdFinal ? [{ escolaId: escolaIdFinal, cargo: 'diretor' }] : [],
            escolaId: escolaIdFinal || undefined
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
            escolaId: escolaIdFinal || undefined
        });

        // 6. WebSocket — só a direção da escola
        emitirParaPerfis(escolaIdFinal, ['diretor', 'admin'], 'new-registration', {
            nome: user.nome,
            perfil: 'Diretor',
            data: dateStr,
            horario: hourStr
        });

        // 7. JWT auto-login
        emitirTokenSessao(res, user);

        // Sessão multi-escola
        if (req.session && escolaIdFinal) {
            req.session.escolaAtivaId = escolaIdFinal;
            req.session.usuarioId = String(user._id);
        }

        res.status(201).json({
            success: true,
            message: 'Conta de diretor criada com sucesso!',
            user: { id: user._id, nome: user.nome, perfil: user.perfil, email: user.email },
            redirect_to: getRedirectPath(user)
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
    const { nome, email, senha, telefone, escola, codigoEscola, escolaId } = req.body;

    try {
        if (!nome || !email || !senha || !telefone || !codigoEscola) {
            return res.status(400).json({ success: false, error: 'Todos os campos são obrigatórios, incluindo o Código Secreto da Escola.' });
        }

        // 1. Valida o código secreto (por escola quando escolaId presente)
        const SecurityController = require('./SecurityController');
        const codeResult = await SecurityController.validateCode(codigoEscola, escolaId || null);
        if (!codeResult) {
            console.log(`⚠️ [REGISTER-SECRETARIA] Código inválido para escolaId=${escolaId || '(auto)'}`);
            return res.status(403).json({ success: false, error: 'Código Secreto da Escola inválido ou expirado. Solicite o código atual à direção da escola.' });
        }
        const escolaResolvida = codeResult.escola || null;
        const escolaIdFinal = escolaResolvida ? String(escolaResolvida._id) : null;

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
        // `escolaId` é OBRIGATÓRIO aqui: UserController.list filtra a coleção
        // `usuarios` por escolaMatch(req.escolaId). Sem o carimbo, a conta
        // existia mas ficava invisível em "Gerenciar Secretaria" — o diretor
        // via a lista vazia mesmo com secretarias cadastradas na escola dele.
        const user = await Usuario.create({
            nome,
            email: email.toLowerCase(),
            senha: senhaHash,
            telefone,
            escola: escolaResolvida ? escolaResolvida.nome : (escola || undefined),
            escolaId: escolaIdFinal || undefined,
            perfil: 'secretaria',
            ativo: true,
            ultimoLogin: now,
            lastLogin: now,
            consentimentoAceiteEm: now
        });

        // 4. Auto-criação do registro na coleção 'secretarias' (com o vínculo
        //    da escola — é por ele que o login resolve o tenant da conta)
        await criarPerfilSecretaria(user, escolaResolvida ? escolaResolvida.nome : escola);

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
            escolaId: escolaIdFinal || undefined
        });

        // 6. WebSocket — só a direção da escola
        emitirParaPerfis(escolaIdFinal, ['diretor', 'admin'], 'new-registration', {
            nome: user.nome,
            perfil: 'Secretaria',
            data: dateStr,
            horario: hourStr
        });

        // 7. JWT auto-login
        emitirTokenSessao(res, user);

        // Sessão multi-escola
        if (req.session && escolaIdFinal) {
            req.session.escolaAtivaId = escolaIdFinal;
            req.session.usuarioId = String(user._id);
        }

        res.status(201).json({
            success: true,
            message: 'Conta de secretaria criada com sucesso!',
            user: { id: user._id, nome: user.nome, perfil: user.perfil, email: user.email },
            redirect_to: getRedirectPath(user)
        });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
};
