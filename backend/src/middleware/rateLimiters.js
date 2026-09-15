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
 * de endereço à vontade. `chaveIp()` colapsa o endereço no prefixo /64. De onde
 * vem o IP (e quais proxies são confiáveis) está em utils/ipCliente.js.
 *
 * ARMAZENAMENTO: todo limitador conta no MongoDB (StoreMongoRateLimit), com
 * prefixo próprio. Na memória do processo, cada instância tinha o seu contador
 * e o teto real se multiplicava pelo número de instâncias e zerava a cada
 * reinício. Ver config/rateLimit.js e docs/RATE-LIMIT.md.
 */
const rateLimit = require('express-rate-limit');
const crypto = require('node:crypto');
const jwt = require('jsonwebtoken');
const JWT_SECRET = require('../utils/jwtConfig');
const { chaveIp } = require('../utils/ipCliente');
const { tipoDeArmazenamento, configuracaoGlobal, regrasPorRota } = require('../config/rateLimit');
const StoreMongoRateLimit = require('../services/protecaoAbuso/StoreMongoRateLimit');

const isProduction = process.env.NODE_ENV === 'production';
const isTest = process.env.NODE_ENV === 'test';

// Em teste nenhum limiter conta — as suítes disparam centenas de requests.
const pularEmTeste = () => isTest;

/**
 * Armazenamento de um limitador. Uma instância por limitador (a biblioteca
 * recusa reaproveitar) e o nome vira prefixo, para que `ip:1.2.3.4` do login
 * e `ip:1.2.3.4` do chat não somem no mesmo contador.
 */
function criarStore(nome) {
    if (tipoDeArmazenamento() !== 'mongo') return undefined; // MemoryStore padrão
    return new StoreMongoRateLimit(`rl:${nome}`);
}

/**
 * Resposta 429 com o mesmo contrato do login: `codigo` para o front reagir sem
 * ler o texto, e `retryEmSegundos` junto do cabeçalho `Retry-After`.
 */
function responderLimite(mensagem) {
    return (req, res, _next, opcoes) => {
        const reset = req.rateLimit?.resetTime;
        const restanteMs = reset ? reset.getTime() - Date.now() : opcoes.windowMs;
        res.status(opcoes.statusCode).json({
            ...mensagem,
            codigo: 'MUITAS_TENTATIVAS',
            retryEmSegundos: Math.max(1, Math.ceil(restanteMs / 1000)),
        });
    };
}

/**
 * Id do usuário autenticado, lido do JWT com a assinatura VERIFICADA.
 *
 * O limitador global roda antes do authJWT das rotas, então `req.user` ainda
 * não existe. Decodificar sem verificar deixaria qualquer um forjar um token
 * com id aleatório e ganhar um contador novo a cada requisição; com a
 * verificação, token inválido simplesmente cai no contador por IP.
 * Não consulta o banco: revogação e conta desativada são problema do authJWT,
 * aqui só importa de quem é a assinatura.
 *
 * Token VENCIDO continua contando pela conta (`ignoreExpiration`). A aba
 * esquecida aberta com a sessão expirada segue fazendo chamadas periódicas;
 * contada pelo IP, ela gastaria o teto anônimo da escola inteira e poderia
 * barrar quem está tentando entrar. A assinatura ainda prova de quem é o
 * navegador, e o authJWT continua recusando o token vencido normalmente.
 */
function idDoUsuarioDoToken(req) {
    if (req._rateLimitUsuario !== undefined) return req._rateLimitUsuario;
    let id = '';
    let token = req.cookies?.escola_jwt;
    const autorizacao = req.headers?.authorization;
    if (!token && typeof autorizacao === 'string' && autorizacao.startsWith('Bearer ')) {
        token = autorizacao.slice(7).trim();
    }
    if (token && token !== 'null' && token !== 'undefined') {
        try {
            const decodificado = jwt.verify(token, JWT_SECRET, { ignoreExpiration: true });
            if (!decodificado.purpose || decodificado.purpose === 'session') {
                id = String(decodificado.id || decodificado._id || '');
            }
        } catch {
            id = '';
        }
    }
    req._rateLimitUsuario = id;
    return id;
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
    // é o Mongo compartilhado) e para manter a chave de tamanho fixo.
    return crypto.createHash('sha256').update(normalizado).digest('hex').slice(0, 32);
}

const RESPOSTA_PADRAO = {
    success: false,
    error: 'Muitas tentativas. Aguarde alguns minutos e tente novamente.',
};

/**
 * Fábrica de limiter keyed por IP (com normalização IPv6).
 */
function limiterPorIp({ nome, windowMs, maxProd, maxDev, mensagem, pular }) {
    return rateLimit({
        windowMs,
        max: isProduction ? maxProd : maxDev,
        keyGenerator: (req) => `ip:${chaveIp(req)}`,
        skip: pular || pularEmTeste,
        handler: responderLimite(mensagem || RESPOSTA_PADRAO),
        store: criarStore(nome),
        standardHeaders: true,
        legacyHeaders: false,
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
function limiterPorConta({ nome, windowMs, maxProd, maxDev, mensagem }) {
    return rateLimit({
        windowMs,
        max: isProduction ? maxProd : maxDev,
        keyGenerator: (req) => `conta:${identificadorDaConta(req)}`,
        skip: (req) => isTest || !identificadorDaConta(req),
        handler: responderLimite(mensagem || RESPOSTA_PADRAO),
        store: criarStore(nome),
        standardHeaders: true,
        legacyHeaders: false,
    });
}

/**
 * Fábrica de limiter keyed pelo USUÁRIO AUTENTICADO.
 *
 * Diferente de `limiterPorConta` (que lê o alvo do corpo, para rotas
 * pré-autenticação), este usa `req.user` — serve para rotas já autenticadas
 * cujo custo não é de segurança e sim de RECURSO: cada chamada gasta cota de
 * uma API externa paga. Sem ele, o teto efetivo era só o globalLimiter, o que
 * torna trivial queimar a cota de ElevenLabs/Gemini do projeto com uma única
 * conta válida.
 *
 * Sem usuário resolvido, cai no limiter por IP que roda em série.
 */
function limiterPorUsuario({ nome, windowMs, maxProd, maxDev, mensagem }) {
    const idDoUsuario = (req) => String(req.user?.id || req.user?._id || '');
    return rateLimit({
        windowMs,
        max: isProduction ? maxProd : maxDev,
        keyGenerator: (req) => `user:${idDoUsuario(req)}`,
        skip: (req) => isTest || !idDoUsuario(req),
        handler: responderLimite(mensagem || RESPOSTA_PADRAO),
        store: criarStore(nome),
        standardHeaders: true,
        legacyHeaders: false,
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

// ── Global: teto geral de /api ───────────────────────────────────────────────
// ESTE LIMITADOR NUNCA TINHA RODADO. Ele é montado em `app.use('/api', …)` e
// pulava quando `!req.path.startsWith('/api')` — mas dentro de um middleware
// montado em `/api` o Express entrega `req.path` SEM o prefixo (`/api/alunos`
// chega como `/alunos`), então o skip era sempre verdadeiro (Issue #333).
//
// Quem não está autenticado conta pelo IP (100/min por padrão); quem está,
// pela conta (200/min). A escola inteira costuma sair por um IP só, e contar
// o professor autenticado pelo IP colocaria a sala dos professores toda no
// mesmo teto. Tetos e janela em config/rateLimit.js.
//
// Precisa vir DEPOIS do cookieParser no app.js: é do cookie que sai o usuário.
const ROTAS_ISENTAS_DO_GLOBAL = ['/health'];

function criarLimiteGlobal({
    config = configuracaoGlobal(),
    pular = pularEmTeste,
    nome = 'global',
} = {}) {
    return rateLimit({
        windowMs: config.janelaMs,
        limit: (req) => (idDoUsuarioDoToken(req) ? config.maxUsuario : config.maxIp),
        keyGenerator: (req) => {
            const usuario = idDoUsuarioDoToken(req);
            return usuario ? `usuario:${usuario}` : `ip:${chaveIp(req)}`;
        },
        // Relativo ao ponto de montagem (`/api`): `/health` é `/api/health`.
        skip: (req) =>
            pular(req) ||
            ROTAS_ISENTAS_DO_GLOBAL.some((r) => req.path === r || req.path.startsWith(`${r}/`)),
        handler: responderLimite({
            success: false,
            error: 'Muitas requisições em pouco tempo. Aguarde alguns instantes e tente novamente.',
        }),
        store: criarStore(nome),
        standardHeaders: true,
        legacyHeaders: false,
    });
}

const globalLimiter = criarLimiteGlobal();

// ── Regras por endpoint vindas do ambiente (RATE_LIMIT_ROTAS) ────────────────
// Permite apertar um endpoint específico em produção sem deploy de código.
// Cada regra tem contador próprio e vale SOMADA ao teto global. Montado sem
// prefixo no app.js, por isso compara com o caminho completo.
function caminhoCompleto(req) {
    return `${req.baseUrl || ''}${req.path}`;
}

function criarLimitesPorRota(regras = regrasPorRota(), { pular = pularEmTeste } = {}) {
    return regras.map((regra) => {
        const casa = (req) => {
            if (regra.metodo !== '*' && req.method !== regra.metodo) return false;
            const caminho = caminhoCompleto(req);
            return caminho === regra.caminho || caminho.startsWith(`${regra.caminho}/`);
        };
        const chave = (req) => {
            const usuario = regra.chave === 'ip' ? '' : idDoUsuarioDoToken(req);
            if (usuario) return `usuario:${usuario}`;
            return regra.chave === 'usuario' ? '' : `ip:${chaveIp(req)}`;
        };
        return rateLimit({
            windowMs: regra.janelaMs,
            limit: regra.limite,
            keyGenerator: chave,
            // Regra "usuario" sem usuário autenticado não conta: quem cobre
            // o anônimo é o teto global por IP.
            skip: (req) => pular(req) || !casa(req) || !chave(req),
            handler: responderLimite({
                success: false,
                error: 'Muitas requisições a este recurso. Aguarde alguns instantes.',
            }),
            store: criarStore(`rota:${regra.nome}`),
            standardHeaders: true,
            legacyHeaders: false,
        });
    });
}

const limitesPorRota = criarLimitesPorRota();

// ── Recuperação de senha ─────────────────────────────────────────────────────
// O POST /api/auth/login saiu daqui: ele passa pelo middleware/protecaoLogin.js,
// que conta só a tentativa que FALHA e bloqueia o IP de forma progressiva.
// Este par continua em forgot-password e reset-password.
const MSG_AUTH = {
    success: false,
    error: 'Muitas tentativas de login ou recuperação. Tente novamente em 15 minutos.',
};

const authIpLimiter = limiterPorIp({
    nome: 'auth-ip',
    windowMs: QUINZE_MIN,
    maxProd: tetoEnv('RATE_LIMIT_LOGIN_IP', 15),
    maxDev: 200,
    mensagem: MSG_AUTH,
});

// Orçamento por CONTA: 10 tentativas/15min independente de quantos IPs usarem.
// Mais apertado que o teto por IP de propósito — um usuário legítimo errando a
// senha raramente passa de 3 ou 4 tentativas, e o bloqueio de conta do próprio
// login já dispara em 5. Ajustável via RATE_LIMIT_LOGIN_CONTA se o suporte
// indicar atrito real.
const authContaLimiter = limiterPorConta({
    nome: 'auth-conta',
    windowMs: QUINZE_MIN,
    maxProd: tetoEnv('RATE_LIMIT_LOGIN_CONTA', 10),
    maxDev: 200,
    mensagem: MSG_AUTH,
});

// ── Endpoints que validam SEGREDOS CURTOS (códigos de 6 dígitos) ─────────────
const MSG_CODIGO = {
    success: false,
    error: 'Muitas tentativas de verificação de código. Tente novamente mais tarde.',
};

const codeIpLimiter = limiterPorIp({
    nome: 'codigo-ip',
    windowMs: UMA_HORA,
    maxProd: tetoEnv('RATE_LIMIT_CODIGO_IP', 30),
    maxDev: 300,
    mensagem: MSG_CODIGO,
});

// 10^6 códigos possíveis: sem teto por conta, um pool de IPs varre o espaço.
// 10 tentativas/hora por conta torna a busca inviável.
const codeContaLimiter = limiterPorConta({
    nome: 'codigo-conta',
    windowMs: UMA_HORA,
    maxProd: tetoEnv('RATE_LIMIT_CODIGO_CONTA', 10),
    maxDev: 300,
    mensagem: MSG_CODIGO,
});

// ── Prefixo /api/auth (cadastro, ativação, 2FA) ──────────────────────────────
const MSG_PREFIXO = {
    success: false,
    error: 'Muitas requisições de autenticação. Tente novamente em 15 minutos.',
};

const authPrefixLimiter = limiterPorIp({
    nome: 'auth-prefixo',
    windowMs: QUINZE_MIN,
    maxProd: 60,
    maxDev: 600,
    mensagem: MSG_PREFIXO,
    pular: (req) => isTest || req.method === 'GET' || req.method === 'HEAD',
});

// ── Síntese de voz (TTS) — cota de API externa PAGA ──────────────────────────
// Teto por conta (não por IP): o custo é por chamada e pertence ao projeto,
// não à rede de origem. Ajustável por RATE_LIMIT_TTS_USUARIO.
//
// Subiu de 60 para 200/hora quando o copiloto passou a narrar a resposta EM
// TRECHOS, acompanhando o texto conforme ele é escrito na tela (ver
// js/ia/SegmentadorFala.js). Uma resposta que antes valia 1 requisição hoje
// vale de 2 a 5 — o mesmo áudio, cortado em frases para começar a tocar sem
// esperar a resposta inteira.
//
// O que este limitador protege é a cota paga, e o provedor cobra por
// CARACTERE, não por requisição. O total de caracteres falados numa sessão não
// mudou; só a contagem de chamadas. Quem continua segurando o volume real é o
// MAX_CARACTERES_TTS de routes/tts.js, que trava o tamanho de cada corpo — e
// os trechos do copiloto não passam de ~1800 caracteres (TETO_TRECHO).
//
// 200/hora dá ~50 respostas narradas por hora por conta, que continua bem
// acima de qualquer uso humano e bem abaixo do que um script conseguiria
// queimar antes de o teto fechar.
const ttsUsuarioLimiter = limiterPorUsuario({
    nome: 'tts-usuario',
    windowMs: UMA_HORA,
    maxProd: tetoEnv('RATE_LIMIT_TTS_USUARIO', 200),
    maxDev: 600,
    mensagem: {
        success: false,
        error: 'Limite de narrações por hora atingido. Tente novamente mais tarde.',
    },
});

// O teto por IP acompanha na mesma proporção do teto por conta: a escola
// inteira costuma sair pelo mesmo endereço, e deixá-lo para trás faria a sala
// dos professores esbarrar no limite de IP muito antes de qualquer conta
// esbarrar no dela.
const ttsIpLimiter = limiterPorIp({
    nome: 'tts-ip',
    windowMs: UMA_HORA,
    maxProd: tetoEnv('RATE_LIMIT_TTS_IP', 400),
    maxDev: 1200,
    mensagem: {
        success: false,
        error: 'Limite de narrações por hora atingido. Tente novamente mais tarde.',
    },
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
    nome: 'chat-mensagem',
    windowMs: UM_MINUTO,
    maxProd: tetoEnv('RATE_LIMIT_CHAT_MENSAGENS', 30),
    maxDev: 300,
    mensagem: {
        success: false,
        error: 'Você enviou muitas mensagens em pouco tempo. Aguarde um minuto.',
    },
});

// Upload é ordens de grandeza mais caro que texto (banda + GridFS), então tem
// orçamento próprio e mais apertado.
const chatUploadLimiter = limiterPorUsuario({
    nome: 'chat-upload',
    windowMs: UM_MINUTO * 5,
    maxProd: tetoEnv('RATE_LIMIT_CHAT_UPLOADS', 20),
    maxDev: 200,
    mensagem: {
        success: false,
        error: 'Muitos arquivos enviados em sequência. Aguarde alguns minutos.',
    },
});

// Rede como um todo: se o limiter por usuário for contornado com várias contas,
// o teto por IP ainda segura o volume vindo de uma única origem.
const chatIpLimiter = limiterPorIp({
    nome: 'chat-ip',
    windowMs: UM_MINUTO,
    maxProd: tetoEnv('RATE_LIMIT_CHAT_IP', 120),
    maxDev: 1200,
    mensagem: {
        success: false,
        error: 'Muitas mensagens vindas desta rede. Aguarde um minuto.',
    },
});

// ── Copiloto de IA ───────────────────────────────────────────────────────────
// Mesma natureza do TTS: cada mensagem gasta cota de uma API externa PAGA, e o
// custo pertence ao projeto. Por isso o teto principal é por CONTA — o
// globalLimiter é genérico demais para servir de freio aqui.
//
// 20/minuto cobre com folga uma conversa humana (ninguém digita mais que isso)
// e inviabiliza o laço automatizado que queimaria a cota do modelo com uma
// única credencial válida.
const iaChatUsuarioLimiter = limiterPorUsuario({
    nome: 'ia-usuario',
    windowMs: UM_MINUTO,
    maxProd: tetoEnv('RATE_LIMIT_IA_USUARIO', 20),
    maxDev: 200,
    mensagem: {
        success: false,
        error: 'Você enviou muitas mensagens seguidas ao assistente. Aguarde alguns instantes.',
    },
});

// `limiterPorConta`/`limiterPorUsuario` se auto-desligam quando não conseguem
// resolver o identificador. Este par por IP é a rede de segurança para esse
// caso — sem ele o endpoint ficaria sem teto próprio.
const iaChatIpLimiter = limiterPorIp({
    nome: 'ia-ip',
    windowMs: UM_MINUTO,
    maxProd: tetoEnv('RATE_LIMIT_IA_IP', 40),
    maxDev: 400,
    mensagem: {
        success: false,
        error: 'Muitas mensagens ao assistente vindas desta rede. Aguarde um minuto.',
    },
});

// ── Importação de alunos (pré-visualização) ──────────────────────────────────
// Parsear um PDF de 30+ alunos custa CPU e memória — os dois recursos mais
// escassos do plano free do Render. Uma conta válida em laço derruba a
// instância inteira sem precisar de nenhuma falha de segurança.
//
// Chave por USUÁRIO: a escola toda sai pelo mesmo IP, e limitar por rede
// puniria a secretaria inteira por causa de uma pessoa. 10 uploads/hora (§7.6)
// é folgado — uma escola grande tem ~30 classes e importa cada uma uma vez.
const importacaoPreviewLimiter = limiterPorUsuario({
    nome: 'importacao-usuario',
    windowMs: UMA_HORA,
    maxProd: tetoEnv('RATE_LIMIT_IMPORTACAO_USUARIO', 10),
    maxDev: 100,
    mensagem: {
        success: false,
        error: 'Você atingiu o limite de 10 importações por hora. Aguarde antes de enviar outro arquivo.',
    },
});

// Rede de segurança: `limiterPorUsuario` se auto-desliga quando não resolve o
// usuário, e sem este par o endpoint ficaria sem teto próprio.
const importacaoIpLimiter = limiterPorIp({
    nome: 'importacao-ip',
    windowMs: UMA_HORA,
    maxProd: tetoEnv('RATE_LIMIT_IMPORTACAO_IP', 40),
    maxDev: 400,
    mensagem: {
        success: false,
        error: 'Muitas importações vindas desta rede. Aguarde alguns minutos.',
    },
});

// ── Moderação: denúncia e contestação ────────────────────────────────────────
// Os dois endpoints são vetores de abuso ANTES de serem vetores de custo (R7 da
// ESPEC-MODERACAO-CHAT.md): sem teto, uma conta consegue encher a fila da
// coordenação de denúncias infundadas até a fila deixar de ser usável — e o
// alvo das denúncias vira vítima de assédio por processo, não por mensagem.
//
// 10/hora por CONTA, como sugere §8.4. Ninguém denuncia dez mensagens por hora
// de boa-fé; quem precisa disso está reportando um incidente que merece
// telefonema à direção, não formulário.
const moderacaoAbusoLimiter = limiterPorUsuario({
    nome: 'moderacao-usuario',
    windowMs: UMA_HORA,
    maxProd: tetoEnv('RATE_LIMIT_MODERACAO', 10),
    maxDev: 100,
    mensagem: {
        success: false,
        error: 'Você atingiu o limite de envios por hora. Se for urgente, procure a direção da escola.',
    },
});

module.exports = {
    globalLimiter,
    limitesPorRota,
    moderacaoAbusoLimiter,
    importacaoPreviewLimiter,
    importacaoIpLimiter,
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
    identificadorDaConta,
    criarLimiteGlobal,
    criarLimitesPorRota,
};
