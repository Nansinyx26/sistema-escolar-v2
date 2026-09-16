/**
 * protecaoLogin.js — freio de força bruta por IP no POST /api/auth/login.
 *
 * O QUE CONTA
 * -----------
 * Só a tentativa que FALHA por credencial (HTTP 401). Login certo, escolha de
 * escola e desafio de 2FA não consomem tentativa: numa escola que sai por um
 * IP só, a entrada da manhã não pode esbarrar num teto que existe para quem
 * erra senha de propósito.
 *
 * O QUE ACONTECE NO TETO
 * ----------------------
 * Com os padrões, 5 falhas em 15 minutos bloqueiam o IP por 15 minutos. Cada
 * reincidência dobra o bloqueio (30 min, 1 h, 2 h…) até o teto configurado.
 * Nenhum bloqueio é permanente: todos têm data para acabar, e o registro some
 * sozinho depois (índice TTL). Valores em config/rateLimit.js.
 *
 * O QUE NÃO SUBSTITUI
 * -------------------
 * O bloqueio por CONTA (`lockUntil` no UserController e `authContaLimiter`)
 * continua valendo. Este freio segura um IP varrendo muitas contas; aquele
 * segura muitos IPs convergindo numa conta só.
 */
const crypto = require('node:crypto');
const { configuracaoLogin } = require('../config/rateLimit');
const BloqueioIpService = require('../services/protecaoAbuso/BloqueioIpService');
const { ipDoCliente, chaveIp } = require('../utils/ipCliente');
const { logAction } = require('../utils/auditHelper');
const logger = require('../utils/logger');
const observability = require('../observability');

const ESCOPO = 'login';

// O IP é dado pessoal e não vai para o log em claro. Um hash com sal do
// processo ainda permite ver que as linhas são do mesmo IP.
const SAL_DO_PROCESSO = crypto.randomBytes(16).toString('hex');
const hashDaChave = (chave) =>
    crypto.createHash('sha256').update(`${SAL_DO_PROCESSO}:${chave}`).digest('hex').slice(0, 12);

const falhouPorCredencial = (res) => res.statusCode === 401;

// Em teste as suítes erram senha de propósito o tempo todo; o freio só liga
// quando a própria suíte pede.
const pularPadrao = () =>
    process.env.NODE_ENV === 'test' && process.env.RATE_LIMIT_EM_TESTE !== 'true';

function responderBloqueado(res, restanteMs) {
    const segundos = Math.max(1, Math.ceil(restanteMs / 1000));
    const minutos = Math.ceil(segundos / 60);
    res.set('Retry-After', String(segundos));
    return res.status(429).json({
        success: false,
        ok: false,
        codigo: 'MUITAS_TENTATIVAS',
        retryEmSegundos: segundos,
        error: `Muitas tentativas de login sem sucesso a partir desta rede. Tente novamente em ${minutos} minuto${minutos > 1 ? 's' : ''}.`,
    });
}

function bloquearERegistrar(req, chave, config, agora) {
    // Span próprio: o bloqueio é o evento que alguém vai querer achar num trace
    // quando uma escola reclamar que "o login parou".
    return observability.withSpan('auth.bloqueioIp', { escopo: ESCOPO }, async (span) => {
        const bloqueio = await BloqueioIpService.bloquear(ESCOPO, chave, config, agora);
        span.setAttribute('bloqueio.aplicado', bloqueio.aplicado);
        span.setAttribute('bloqueio.nivel', bloqueio.nivel);
        if (bloqueio.aplicado) await registrarBloqueio(req, chave, config, bloqueio);
        return bloqueio;
    });
}

async function registrarBloqueio(req, chave, config, bloqueio) {
    const minutos = Math.round(bloqueio.duracaoMs / 60000);
    const contexto = {
        ipHash: hashDaChave(chave),
        nivel: bloqueio.nivel,
        duracaoMin: minutos,
        maxFalhas: config.maxFalhas,
        action: 'auth.ipBloqueado',
    };
    // Reincidência alta é ataque em andamento, não engano: vira alerta.
    if (bloqueio.nivel >= 3) {
        logger.alert('BRUTE_FORCE_IP', 'IP reincidente bloqueado no login', contexto);
    } else {
        logger.warn('[auth] IP bloqueado por excesso de tentativas de login', contexto);
    }
    // Registro do excesso na auditoria (o IP entra por lá, como em todo evento
    // de segurança, com o prazo de guarda da auditoria).
    await logAction(req, 'LOGIN_IP_BLOQUEADO', 'Segurança', {
        descricao: `IP bloqueado por ${minutos} min após ${config.maxFalhas} tentativas de login sem sucesso (reincidência ${bloqueio.nivel}).`,
    });
}

/**
 * @param {object} [opcoes]
 * @param {() => object} [opcoes.configuracao] tetos e janelas (padrão: ambiente)
 * @param {() => Date} [opcoes.relogio] fonte de tempo (os testes adiantam o relógio)
 * @param {(req) => boolean} [opcoes.pular]
 * @param {(p: Promise) => void} [opcoes.aoConcluir] recebe a escrita feita
 *   depois da resposta (os testes esperam por ela em vez de usar sleep)
 */
function criarProtecaoLogin({
    configuracao = configuracaoLogin,
    relogio = () => new Date(),
    pular = pularPadrao,
    aoConcluir = null,
} = {}) {
    return async function protecaoLogin(req, res, next) {
        if (pular(req)) return next();

        const config = configuracao();
        const ip = ipDoCliente(req);
        // Sem IP resolvido não há chave justa: um bucket único para "sem IP"
        // bloquearia todo mundo junto. O bloqueio por conta segue valendo.
        if (!ip || config.ipsLivres.contem(ip)) return next();

        const chave = chaveIp(req);
        let tentativas;
        try {
            const registro = await BloqueioIpService.registrarTentativa(
                ESCOPO,
                chave,
                config,
                relogio()
            );
            if (registro.restanteMs > 0) return responderBloqueado(res, registro.restanteMs);

            tentativas = registro.tentativas;
            if (tentativas > config.maxFalhas) {
                const bloqueio = await bloquearERegistrar(req, chave, config, relogio());
                return responderBloqueado(res, bloqueio.restanteMs);
            }
        } catch (erro) {
            // Banco indisponível: o login também depende dele e vai responder
            // o erro próprio. Travar aqui só trocaria a mensagem.
            logger.warn('[auth] Proteção de login por IP indisponível; seguindo sem ela', {
                errName: erro?.name,
                action: 'auth.protecaoIndisponivel',
            });
            observability.captureException(erro, {
                rota: 'POST /api/auth/login',
                etapa: 'protecaoLogin',
            });
            return next();
        }

        res.on('finish', () => {
            let concluir = null;
            if (!falhouPorCredencial(res)) {
                concluir = BloqueioIpService.devolverTentativa(ESCOPO, chave, relogio());
            } else if (tentativas >= config.maxFalhas) {
                // A falha que atinge o teto já bloqueia: a próxima tentativa
                // recebe o 429 com o tempo certo, sem precisar gastar mais uma.
                concluir = bloquearERegistrar(req, chave, config, relogio());
            }
            const escrita = Promise.resolve(concluir).catch((erro) => {
                logger.warn('[auth] Falha ao atualizar a proteção de login por IP', {
                    errName: erro?.name,
                    action: 'auth.protecaoIndisponivel',
                });
            });
            if (aoConcluir) aoConcluir(escrita);
        });

        return next();
    };
}

module.exports = { criarProtecaoLogin, protecaoLogin: criarProtecaoLogin() };
