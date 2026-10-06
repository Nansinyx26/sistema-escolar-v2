/**
 * trocaEmail.js — a própria pessoa troca o e-mail da conta, provando a posse
 * do endereço novo (Issue #609, épico #608).
 *
 * POR QUE O CUIDADO
 * -----------------
 * O e-mail não é só o login: é a chave que liga o responsável ao filho. A ficha
 * do aluno guarda o endereço em `responsavel`, `responsavelDados.email` e
 * `responsaveis[].email`, e o bloqueio por decisão judicial também é por
 * e-mail (`restricoesAcesso[].email`). Até a Issue #571 qualquer conta trocava
 * o próprio e-mail pelo perfil e, com isso, passava a ser "responsável" pelo
 * aluno cuja ficha tivesse o endereço novo.
 *
 * A troca agora exige:
 *   - a senha atual, para que uma sessão esquecida aberta não baste;
 *   - a posse do endereço novo, provada pelo link que só ele recebe. É a mesma
 *     prova do cadastro: quem controla a caixa postal poderia criar uma conta
 *     com ela de qualquer jeito;
 *   - a confirmação feita na mesma conta que pediu. Abrir o link não confirma:
 *     leitores de e-mail abrem links sozinhos, e quem recebe o link pode não ser
 *     o dono da conta.
 *
 * Confirmada a troca, tudo que apontava para o endereço antigo passa a apontar
 * para o novo. Sem isso a família perderia o acesso aos filhos — e o bloqueio
 * judicial deixaria de valer para quem trocou de e-mail.
 */
const crypto = require('node:crypto');
const Aluno = require('../models/Aluno');
const Autorizacao = require('../models/Autorizacao');
const Professor = require('../models/Professor');
const Diretor = require('../models/Diretor');
const Secretaria = require('../models/Secretaria');
const SolicitacaoVinculo = require('../models/SolicitacaoVinculo');
const escapeRegex = require('../utils/escapeRegex');
const logger = require('../utils/logger');

const VALIDADE_HORAS = 2;
const TAMANHO_MAXIMO_EMAIL = 254;

/** Mesmo formato aceito no cadastro, em minúsculas e sem espaços nas pontas. */
function normalizarEmail(valor) {
    if (typeof valor !== 'string') return null;
    const email = valor.trim().toLowerCase();
    if (!email || email.length > TAMANHO_MAXIMO_EMAIL) return null;
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

/** O banco guarda só o hash: quem lê a coleção não tem o link. */
function hashDoToken(token) {
    return crypto.createHash('sha256').update(String(token)).digest('hex');
}

function novoToken() {
    const token = crypto.randomBytes(32).toString('hex');
    return { token, hash: hashDoToken(token) };
}

function validadeDoPedido(agora = Date.now()) {
    return new Date(agora + VALIDADE_HORAS * 3600 * 1000);
}

/**
 * Link da página de confirmação. O token vai no fragmento (`#`), que o
 * navegador não manda ao servidor nem a terceiros no `Referer`: ele não cai em
 * log de acesso, cache de proxy ou cabeçalho de outro site.
 */
function urlDeConfirmacao(token) {
    const base = process.env.FRONTEND_URL || 'http://localhost:3001';
    return `${base}/html/confirmar-email.html#token=${encodeURIComponent(token)}`;
}

/** Igualdade sem diferença de caixa — a ficha não guarda o e-mail normalizado. */
function exato(email) {
    return new RegExp(`^${escapeRegex(email)}$`, 'i');
}

/**
 * Passa para o endereço novo tudo que liga a conta ao antigo.
 *
 * Roda DEPOIS de o e-mail da conta mudar. Na ordem inversa, uma falha ao gravar
 * a conta (o endereço tomado por outra pessoa no meio do caminho) deixaria as
 * fichas apontando para a conta de outra pessoa.
 *
 * Cada etapa é independente: uma falha não impede as outras, e o retorno diz
 * quais falharam para que a auditoria registre o que ficou para a secretaria.
 *
 * @param {{ usuarioId: string, antigo: string, novo: string }} troca
 * @returns {Promise<{ alterados: Object<string, number>, falhas: string[] }>}
 */
async function migrarVinculos({ usuarioId, antigo, novo }) {
    const id = String(usuarioId);
    const deAntes = exato(antigo);
    const alterados = {};
    const falhas = [];

    const etapas = {
        alunoResponsavel: () =>
            Aluno.updateMany({ responsavel: deAntes }, { $set: { responsavel: novo } }),
        alunoResponsavelDados: () =>
            Aluno.updateMany(
                { 'responsavelDados.email': deAntes },
                { $set: { 'responsavelDados.email': novo } }
            ),
        alunoResponsaveis: () =>
            Aluno.updateMany(
                { 'responsaveis.email': deAntes },
                { $set: { 'responsaveis.$[r].email': novo } },
                { arrayFilters: [{ 'r.email': deAntes }] }
            ),
        // Bloqueio judicial acompanha a pessoa: trocar de e-mail não pode ser o
        // jeito de sair dele.
        alunoRestricoes: () =>
            Aluno.updateMany(
                { 'restricoesAcesso.email': deAntes },
                { $set: { 'restricoesAcesso.$[r].email': novo } },
                { arrayFilters: [{ 'r.email': deAntes }] }
            ),
        // Conta de aluno: a ficha dele guarda o próprio e-mail.
        alunoEmail: () => Aluno.updateMany({ email: deAntes }, { $set: { email: novo } }),
        autorizacoes: () =>
            Autorizacao.updateMany(
                { responsavelId: { $in: idsPossiveis(id) } },
                { $set: { responsavelEmail: novo } }
            ),
        // As fichas de equipe guardam uma cópia do e-mail da conta, e o
        // `vinculosDoUsuario` ainda procura por ela.
        professor: () => fichaDeEquipe(Professor, id, deAntes, novo),
        diretor: () => fichaDeEquipe(Diretor, id, deAntes, novo),
        secretaria: () => fichaDeEquipe(Secretaria, id, deAntes, novo),
        solicitacoesPendentes: () => migrarSolicitacoesPendentes(deAntes, novo),
    };

    for (const [nome, etapa] of Object.entries(etapas)) {
        try {
            const r = await etapa();
            alterados[nome] = Number(r?.modifiedCount ?? r ?? 0);
        } catch (err) {
            falhas.push(nome);
            logger.error('[trocaEmail] Vínculo não migrado', {
                err,
                usuarioId: id,
                etapa: nome,
                action: 'trocaEmail.migracaoFalhou',
            });
        }
    }
    return { alterados, falhas };
}

/** `responsavelId` é Mixed: há registros com o id em texto e em ObjectId. */
function idsPossiveis(id) {
    const ids = [id];
    if (/^[a-f0-9]{24}$/i.test(id)) {
        const { Types } = require('mongoose');
        ids.push(new Types.ObjectId(id));
    }
    return ids;
}

function fichaDeEquipe(Modelo, id, deAntes, novo) {
    return Modelo.updateMany(
        { $or: [{ idUsuario: id }, { email: deAntes }] },
        { $set: { email: novo } }
    );
}

/**
 * Pedido de inclusão ainda pendente para o endereço antigo: se a secretaria o
 * aprovasse depois da troca, a ficha ganharia um e-mail que não é de mais
 * ninguém. Um pedido igual já aberto para o endereço novo torna o antigo
 * repetido — o índice único de pendentes recusaria a troca, então ele sai.
 */
async function migrarSolicitacoesPendentes(deAntes, novo) {
    const pendentes = await SolicitacaoVinculo.find({ status: 'pendente', email: deAntes })
        .select('_id alunoId')
        .lean();
    let alterados = 0;
    for (const p of pendentes) {
        const jaExiste = await SolicitacaoVinculo.exists({
            status: 'pendente',
            alunoId: p.alunoId,
            email: novo,
        });
        if (jaExiste) {
            await SolicitacaoVinculo.deleteOne({ _id: p._id });
        } else {
            await SolicitacaoVinculo.updateOne({ _id: p._id }, { $set: { email: novo } });
        }
        alterados += 1;
    }
    return alterados;
}

module.exports = {
    VALIDADE_HORAS,
    normalizarEmail,
    hashDoToken,
    novoToken,
    validadeDoPedido,
    urlDeConfirmacao,
    migrarVinculos,
};
