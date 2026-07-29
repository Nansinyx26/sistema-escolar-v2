/**
 * rateLimiters.js — limitadores de taxa centralizados.
 *
 * PROBLEMA QUE ISTO RESOLVE
 * -------------------------
 * Todos os limiters do projeto eram keyed SÓ por IP. Contra brute force isso
 * é meio freio: quem tem um pool de IPs (botnet, VPN rotativa, IPv6 /64 com
 * 2^64 endereços) martela a MESMA conta indefinidamente, porque cada request
 * chega com uma chave nova e o contador nunca acumula.
 *
 * Agora cada endpoint sensível passa por DOIS limiters em série:
 *   1. por IP    — trava um atacante único varrendo muitas contas;
 *   2. por CONTA — trava muitos IPs convergindo numa conta só.
 *
 * O limiter por conta usa como chave o identificador do alvo (e-mail/CPF
 * normalizado) vindo do corpo da requisição, NÃO o IP. Assim o orçamento de
 * tentativas pertence à conta e é indiferente à origem da rede.
 *
 * IPv6: `req.ip` bruto como chave é furado — um cliente com /64 delegado troca
 * de endereço à vontade. `chaveIp()` colapsa o endereço no prefixo /64.
 */
const rateLimit = require('express-rate-limit');
const crypto = require('crypto');

const isProduction = process.env.NODE_ENV === 'production';
const isTest = process.env.NODE_ENV === 'test';

// Em teste nenhum limiter conta — as suítes disparam centenas de requests.
const pularEmTeste = () => isTest;

/**
 * Normaliza o IP para uso como chave de rate limit.
 * IPv4 → o próprio endereço. IPv6 → prefixo /64 (o bloco que um ISP delega a
 * um único assinante), impedindo que a rotação dentro do próprio bloco zere
 * o contador.
 */
function chaveIp(req) {
    const ip = req.ip || req.socket?.remoteAddress || 'sem-ip';

    // ::ffff:1.2.3.4 → IPv4 mapeado
    const mapeado = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
    if (mapeado) return mapeado[1];

    if (!ip.includes(':')) return ip; // IPv4

    // IPv6: mantém apenas os 4 primeiros hextetos (/64)
    const expandido = ip.split('%')[0]; // remove zone id (fe80::1%eth0)
    const partes = expandido.split(':');
    return `${partes.slice(0, 4).join(':')}::/64`;
}

/**
 * Extrai o identificador da CONTA-ALVO da requisição.
 * Cobre os vários nomes de campo usados pelos endpoints de auth deste projeto.
 */
function identificadorDaConta(req) {
    const b = req.body || {};
    const bruto =
        b.email ||
        b.emailOrCpf ||
        b.usuario ||
        b.login ||
        b.cpf ||
        b.codigoAluno ||
        b.codigoSecreto ||
        null;

    if (!bruto || typeof bruto !== 'string') return null;

    const normalizado = bruto.trim().toLowerCase();
    if (!normalizado) return null;

    // Hash para não gravar e-mail em claro no store do limiter (que em produção
    // pode ser Redis/Mongo compartilhado) e para manter a chave de tamanho fixo.
    return crypto.createHash('sha256').update(normalizado).digest('hex').slice(0, 32);
}

const RESPOSTA_PADRAO = {
    success: false,
    error: 'Muitas tentativas. Aguarde alguns minutos e tente novamente.'
};

/**
 * Fábrica de limiter keyed por IP (com normalização IPv6).
 */
function limiterPorIp({ windowMs, maxProd, maxDev, mensagem, pular }) {
    return rateLimit({
        windowMs,
        max: isProduction ? maxProd : maxDev,
        keyGenerator: (req) => `ip:${chaveIp(req)}`,
        skip: pular || pularEmTeste,
        message: mensagem || RESPOSTA_PADRAO,
        standardHeaders: true,
        legacyHeaders: false
    });
}

/**
 * Fábrica de limiter keyed pela CONTA-ALVO.
 *
 * Se a requisição não traz identificador de conta, o limiter é ignorado — quem
 * cobre esse caso é o limiter por IP que roda em série. Isso evita que todas as
 * requisições anônimas caiam num único bucket compartilhado (o que viraria um
 * DoS trivial: um atacante estouraria a chave global e derrubaria o login de
 * todo mundo).
 */
function limiterPorConta({ windowMs, maxProd, maxDev, mensagem }) {
    return rateLimit({
        windowMs,
        max: isProduction ? maxProd : maxDev,
        keyGenerator: (req) => `conta:${identificadorDaConta(req)}`,
        skip: (req) => isTest || !identificadorDaConta(req),
        message: mensagem || RESPOSTA_PADRAO,
        standardHeaders: true,
        legacyHeaders: false
    });
}

/**
 * Fábrica de limiter keyed pelo USUÁRIO AUTENTICADO.
 *
 * Diferente de `limiterPorConta` (que lê o alvo do corpo, para rotas
 * pré-autenticação), este usa `req.user` — serve para rotas já autenticadas
 * cujo custo não é de segurança e sim de RECURSO: cada chamada gasta cota de
 * uma API externa paga. Sem ele, o teto efetivo era só o globalLimiter
 * (milhares de req/15min por IP), o que torna trivial queimar a cota de
 * ElevenLabs/Gemini do projeto com uma única conta válida.
 *
 * Sem usuário resolvido, cai no limiter por IP que roda em série.
 */
function limiterPorUsuario({ windowMs, maxProd, maxDev, mensagem }) {
    const idDoUsuario = (req) => String(req.user?.id || req.user?._id || '');
    return rateLimit({
        windowMs,
        max: isProduction ? maxProd : maxDev,
        keyGenerator: (req) => `user:${idDoUsuario(req)}`,
        skip: (req) => isTest || !idDoUsuario(req),
        message: mensagem || RESPOSTA_PADRAO,
        standardHeaders: true,
        legacyHeaders: false
    });
}

const QUINZE_MIN = 15 * 60 * 1000;
const UMA_HORA = 60 * 60 * 1000;

/**
 * Lê um teto do ambiente, mantendo o padrão seguro quando a variável está
 * ausente ou é inválida. Afrouxar um limite passa a ser uma decisão explícita
 * de operação (registrada no ambiente), não uma edição de código.
 */
function tetoEnv(nome, padrao) {
    const bruto = parseInt(process.env[nome], 10);
    if (!Number.isFinite(bruto) || bruto <= 0) return padrao;
    return bruto;
}

// ── Global: DoS em /api ──────────────────────────────────────────────────────
const globalLimiter = rateLimit({
    windowMs: QUINZE_MIN,
    max: isProduction ? 2000 : 5000,
    keyGenerator: (req) => `ip:${chaveIp(req)}`,
    message: { success: false, error: 'Muitas requisições vindas deste IP. Tente novamente mais tarde.' },
    skip: (req) => isTest || !req.path.startsWith('/api'),
    standardHeaders: true,
    legacyHeaders: false
});

// ── Login / recuperação de senha ─────────────────────────────────────────────
const MSG_AUTH = {
    success: false,
    error: 'Muitas tentativas de login ou recuperação. Tente novamente em 15 minutos.'
};

const authIpLimiter = limiterPorIp({
    windowMs: QUINZE_MIN,
    maxProd: tetoEnv('RATE_LIMIT_LOGIN_IP', 15),
    maxDev: 200,
    mensagem: MSG_AUTH
});

// Orçamento por CONTA: 10 tentativas/15min independente de quantos IPs usarem.
// Mais apertado que o teto por IP de propósito — um usuário legítimo errando a
// senha raramente passa de 3 ou 4 tentativas, e o bloqueio de conta do próprio
// login já dispara em 5. Ajustável via RATE_LIMIT_LOGIN_CONTA se o suporte
// indicar atrito real.
const authContaLimiter = limiterPorConta({
    windowMs: QUINZE_MIN,
    maxProd: tetoEnv('RATE_LIMIT_LOGIN_CONTA', 10),
    maxDev: 200,
    mensagem: MSG_AUTH
});

// ── Endpoints que validam SEGREDOS CURTOS (códigos de 6 dígitos) ─────────────
const MSG_CODIGO = {
    success: false,
    error: 'Muitas tentativas de verificação de código. Tente novamente mais tarde.'
};

const codeIpLimiter = limiterPorIp({
    windowMs: UMA_HORA,
    maxProd: tetoEnv('RATE_LIMIT_CODIGO_IP', 30),
    maxDev: 300,
    mensagem: MSG_CODIGO
});

// 10^6 códigos possíveis: sem teto por conta, um pool de IPs varre o espaço.
// 10 tentativas/hora por conta torna a busca inviável.
const codeContaLimiter = limiterPorConta({
    windowMs: UMA_HORA,
    maxProd: tetoEnv('RATE_LIMIT_CODIGO_CONTA', 10),
    maxDev: 300,
    mensagem: MSG_CODIGO
});

// ── Prefixo /api/auth (cadastro, ativação, 2FA) ──────────────────────────────
const MSG_PREFIXO = {
    success: false,
    error: 'Muitas requisições de autenticação. Tente novamente em 15 minutos.'
};

const authPrefixLimiter = limiterPorIp({
    windowMs: QUINZE_MIN,
    maxProd: 60,
    maxDev: 600,
    mensagem: MSG_PREFIXO,
    pular: (req) => isTest || req.method === 'GET' || req.method === 'HEAD'
});

// ── Síntese de voz (TTS) — cota de API externa PAGA ──────────────────────────
// Teto por conta (não por IP): o custo é por chamada e pertence ao projeto,
// não à rede de origem. 60/hora cobre com folga a narração de uma sessão de uso
// real; ajustável por RATE_LIMIT_TTS_USUARIO.
const ttsUsuarioLimiter = limiterPorUsuario({
    windowMs: UMA_HORA,
    maxProd: tetoEnv('RATE_LIMIT_TTS_USUARIO', 60),
    maxDev: 600,
    mensagem: {
        success: false,
        error: 'Limite de narrações por hora atingido. Tente novamente mais tarde.'
    }
});

const ttsIpLimiter = limiterPorIp({
    windowMs: UMA_HORA,
    maxProd: tetoEnv('RATE_LIMIT_TTS_IP', 120),
    maxDev: 1200,
    mensagem: {
        success: false,
        error: 'Limite de narrações por hora atingido. Tente novamente mais tarde.'
    }
});

// ── Chat interno ─────────────────────────────────────────────────────────────
// O envio de mensagem não tinha teto nenhum: uma conta válida conseguia
// inundar a caixa de outra pessoa (e, desde que o push existe, a barra de
// notificações do celular dela) no ritmo que a rede aguentasse.
//
// Chave por USUÁRIO, não por IP: o abuso aqui parte de uma conta autenticada,
// e a escola inteira costuma sair pelo mesmo IP — limitar por IP puniria a
// sala de professores toda por causa de um usuário.
//
// 30/minuto é folgado para conversa humana (uma mensagem a cada 2s sustentada)
// e corta o flood automatizado.
const UM_MINUTO = 60 * 1000;

const chatMensagemLimiter = limiterPorUsuario({
    windowMs: UM_MINUTO,
    maxProd: tetoEnv('RATE_LIMIT_CHAT_MENSAGENS', 30),
    maxDev: 300,
    mensagem: {
        success: false,
        error: 'Você enviou muitas mensagens em pouco tempo. Aguarde um minuto.'
    }
});

// Upload é ordens de grandeza mais caro que texto (banda + GridFS), então tem
// orçamento próprio e mais apertado.
const chatUploadLimiter = limiterPorUsuario({
    windowMs: UM_MINUTO * 5,
    maxProd: tetoEnv('RATE_LIMIT_CHAT_UPLOADS', 20),
    maxDev: 200,
    mensagem: {
        success: false,
        error: 'Muitos arquivos enviados em sequência. Aguarde alguns minutos.'
    }
});

// Rede como um todo: se o limiter por usuário for contornado com várias contas,
// o teto por IP ainda segura o volume vindo de uma única origem.
const chatIpLimiter = limiterPorIp({
    windowMs: UM_MINUTO,
    maxProd: tetoEnv('RATE_LIMIT_CHAT_IP', 120),
    maxDev: 1200,
    mensagem: {
        success: false,
        error: 'Muitas mensagens vindas desta rede. Aguarde um minuto.'
    }
});

// ── Copiloto de IA ───────────────────────────────────────────────────────────
// Mesma natureza do TTS: cada mensagem gasta cota de uma API externa PAGA, e o
// custo pertence ao projeto. Por isso o teto principal é por CONTA — o
// globalLimiter (2000/15min por IP) é grande demais para servir de freio aqui.
//
// 20/minuto cobre com folga uma conversa humana (ninguém digita mais que isso)
// e inviabiliza o laço automatizado que queimaria a cota do modelo com uma
// única credencial válida.
const iaChatUsuarioLimiter = limiterPorUsuario({
    windowMs: UM_MINUTO,
    maxProd: tetoEnv('RATE_LIMIT_IA_USUARIO', 20),
    maxDev: 200,
    mensagem: {
        success: false,
        error: 'Você enviou muitas mensagens seguidas ao assistente. Aguarde alguns instantes.'
    }
});

// `limiterPorConta`/`limiterPorUsuario` se auto-desligam quando não conseguem
// resolver o identificador. Este par por IP é a rede de segurança para esse
// caso — sem ele o endpoint ficaria sem teto próprio.
const iaChatIpLimiter = limiterPorIp({
    windowMs: UM_MINUTO,
    maxProd: tetoEnv('RATE_LIMIT_IA_IP', 40),
    maxDev: 400,
    mensagem: {
        success: false,
        error: 'Muitas mensagens ao assistente vindas desta rede. Aguarde um minuto.'
    }
});

module.exports = {
    globalLimiter,
    authIpLimiter,
    authContaLimiter,
    codeIpLimiter,
    codeContaLimiter,
    authPrefixLimiter,
    ttsUsuarioLimiter,
    ttsIpLimiter,
    chatMensagemLimiter,
    chatUploadLimiter,
    chatIpLimiter,
    iaChatUsuarioLimiter,
    iaChatIpLimiter,
    // exportados para teste
    chaveIp,
    identificadorDaConta
};
