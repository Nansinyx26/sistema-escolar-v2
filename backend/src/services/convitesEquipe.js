/**
 * convitesEquipe — regra do convite de uso único para direção e secretaria.
 *
 * Fica em `services/` porque lê models e é usada por dois controllers (o do
 * admin, que cria e revoga, e o de cadastro, que aceita).
 *
 * Situações de um convite:
 *   ativo    → pode ser aceito;
 *   usado    → já virou conta (uso único);
 *   revogado → o admin cancelou;
 *   expirado → passou do prazo.
 * Qualquer situação diferente de `ativo` recusa o aceite com a MESMA resposta,
 * para o aceite não virar oráculo sobre o que aconteceu com o convite.
 */
const crypto = require('node:crypto');
const ConviteEquipe = require('../models/ConviteEquipe');

const PERFIS_CONVIDAVEIS = ['diretor', 'secretaria'];
const HORAS_PADRAO = 72;
const HORAS_MAXIMO = 168;

/** Prazo do convite: `CONVITE_EQUIPE_HORAS`, entre 1 e 168 h (padrão 72 h). */
function horasDeValidade() {
    const n = Number.parseInt(process.env.CONVITE_EQUIPE_HORAS || '', 10);
    if (!Number.isFinite(n) || n < 1) return HORAS_PADRAO;
    return Math.min(n, HORAS_MAXIMO);
}

/** 256 bits aleatórios em base64url — cabe numa URL sem escape. */
function gerarToken() {
    return crypto.randomBytes(32).toString('base64url');
}

function hashDoToken(token) {
    return crypto.createHash('sha256').update(String(token)).digest('hex');
}

function situacao(convite, agora = new Date()) {
    if (!convite) return 'inexistente';
    if (convite.usadoEm) return 'usado';
    if (convite.revogadoEm) return 'revogado';
    if (convite.expiraEm <= agora) return 'expirado';
    return 'ativo';
}

/**
 * Cria o convite e devolve o token em claro (única vez em que ele existe).
 * @returns {Promise<{ convite: object, token: string }>}
 */
async function criarConvite({ email, perfil, escolaId, criadoPor }) {
    const token = gerarToken();
    const expiraEm = new Date(Date.now() + horasDeValidade() * 60 * 60 * 1000);
    const convite = await ConviteEquipe.create({
        tokenHash: hashDoToken(token),
        email: String(email).trim().toLowerCase(),
        perfil,
        escolaId: String(escolaId),
        criadoPor: String(criadoPor),
        expiraEm,
    });
    return { convite, token };
}

/** Localiza o convite pelo token em claro (compara pelo hash). */
async function buscarPorToken(token) {
    if (typeof token !== 'string' || token.length < 20 || token.length > 100) return null;
    return ConviteEquipe.findOne({ tokenHash: hashDoToken(token) }).lean();
}

/**
 * Marca o convite como usado — atômico: só um aceite concorrente vence.
 * @returns {Promise<object|null>} o convite consumido, ou null se já não estava ativo
 */
async function consumir(conviteId) {
    return ConviteEquipe.findOneAndUpdate(
        { _id: conviteId, usadoEm: null, revogadoEm: null, expiraEm: { $gt: new Date() } },
        { $set: { usadoEm: new Date() } },
        { new: true }
    ).lean();
}

/** Desfaz o consumo quando a criação da conta falha depois dele. */
async function devolver(conviteId) {
    await ConviteEquipe.updateOne({ _id: conviteId }, { $set: { usadoEm: null } });
}

async function registrarConta(conviteId, usuarioId) {
    await ConviteEquipe.updateOne(
        { _id: conviteId },
        { $set: { usuarioCriado: String(usuarioId) } }
    );
}

module.exports = {
    PERFIS_CONVIDAVEIS,
    horasDeValidade,
    hashDoToken,
    situacao,
    criarConvite,
    buscarPorToken,
    consumir,
    devolver,
    registrarConta,
};
