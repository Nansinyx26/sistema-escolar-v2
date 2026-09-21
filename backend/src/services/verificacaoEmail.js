/**
 * verificacaoEmail.js — o e-mail da família precisa ser confirmado antes de
 * abrir a ficha do filho (Issue #412).
 *
 * O PROBLEMA
 * ----------
 * O vínculo entre responsável e aluno é decidido pelo e-mail que a secretaria
 * digitou na ficha: `responsavel`, `responsavelDados.email` e
 * `responsaveis[].email`. Quem criasse uma conta com aquele endereço herdava o
 * acesso — e ninguém checava se o endereço era mesmo dele. Digitar o e-mail de
 * outra pessoa é mais fácil do que parece: basta conhecê-lo.
 *
 * Confirmar o e-mail prova posse da caixa postal, que é exatamente o que a
 * ficha usa como chave. Conta que entra pelo Google já chega confirmada — o
 * provedor atesta `email_verified` e o servidor exige isso desde a #387.
 *
 * POR QUE NÍO QUEBRA QUEM JÁ USA
 * ------------------------------
 * A exigência vale para contas criadas a partir do marco (`MARCO_PADRAO`, ou
 * `VERIFICACAO_EMAIL_A_PARTIR_DE`). Conta anterior segue valendo: ela nasceu
 * num sistema que não pedia confirmação, e derrubar o acesso de uma família
 * inteira por causa disso seria trocar um risco por um dano certo.
 */
const crypto = require('node:crypto');
const Usuario = require('../models/Usuario');
const logger = require('../utils/logger');
const { notificarVerificacaoEmail } = require('../utils/emailNotifications');

/** Data em que a exigência entra em vigor. Antes disso, conta legada. */
const MARCO_PADRAO = '2026-09-21T00:00:00.000Z';
const VALIDADE_HORAS = 48;
const CACHE_MS = 60 * 1000;

const cache = new Map(); // id -> { em, conta }

function marcoDaVerificacao() {
    const bruto = process.env.VERIFICACAO_EMAIL_A_PARTIR_DE;
    const data = bruto ? new Date(bruto) : new Date(MARCO_PADRAO);
    return Number.isNaN(data.getTime()) ? new Date(MARCO_PADRAO) : data;
}

/**
 * A conta precisa confirmar o e-mail antes de ver dados de aluno?
 * Só vale para responsável: equipe entra por convite ou código da escola, que
 * já amarram a conta a um e-mail escolhido pela própria escola.
 *
 * @param {{perfil?: string, emailVerificado?: boolean, createdAt?: Date}} conta
 */
function exigeVerificacao(conta) {
    if (!conta) return false;
    if (String(conta.perfil || '').toLowerCase() !== 'responsavel') return false;
    if (conta.emailVerificado) return false;
    const nascimento = conta.createdAt ? new Date(conta.createdAt) : null;
    if (!nascimento || Number.isNaN(nascimento.getTime())) return false; // legado sem data
    return nascimento >= marcoDaVerificacao();
}

/** Lê a conta (com cache curto) e decide. Usado nos guards por requisição. */
async function contaPrecisaConfirmar(usuarioId) {
    const id = String(usuarioId || '');
    if (!id) return false;
    const agora = Date.now();
    const guardado = cache.get(id);
    if (guardado && agora - guardado.em < CACHE_MS) return exigeVerificacao(guardado.conta);

    const conta = await Usuario.findById(id).select('perfil emailVerificado createdAt').lean();
    cache.set(id, { em: agora, conta });
    return exigeVerificacao(conta);
}

/** Esquece o que estava guardado — chamado quando a conta confirma. */
function invalidarCacheDeVerificacao(usuarioId) {
    if (usuarioId) cache.delete(String(usuarioId));
    else cache.clear();
}

function urlDeVerificacao(token) {
    const base = process.env.FRONTEND_URL || 'http://localhost:3001';
    return `${base}/api/auth/verify-email/${token}`;
}

/**
 * Gera o token, grava na conta e envia o e-mail. O envio é o único caminho:
 * o token não volta na resposta — quem não tem a caixa postal não o recebe.
 *
 * @returns {Promise<boolean>} true se o e-mail foi disparado
 */
async function enviarVerificacao(usuario) {
    if (!usuario?.email) return false;
    const token = crypto.randomBytes(32).toString('hex');
    await Usuario.updateOne(
        { _id: usuario._id },
        {
            $set: {
                emailVerificacaoToken: token,
                emailVerificacaoExpiry: Date.now() + VALIDADE_HORAS * 3600 * 1000,
            },
        }
    );
    invalidarCacheDeVerificacao(usuario._id);
    try {
        await notificarVerificacaoEmail(usuario.email, usuario.nome, urlDeVerificacao(token));
        return true;
    } catch (e) {
        // Falha de entrega não derruba o cadastro: a pessoa pede o reenvio.
        logger.warn('[verificacao] E-mail de confirmação não entregue', {
            err: e,
            usuarioId: String(usuario._id),
            action: 'verificacao.envioFalhou',
        });
        return false;
    }
}

module.exports = {
    MARCO_PADRAO,
    VALIDADE_HORAS,
    marcoDaVerificacao,
    exigeVerificacao,
    contaPrecisaConfirmar,
    invalidarCacheDeVerificacao,
    enviarVerificacao,
    urlDeVerificacao,
};
