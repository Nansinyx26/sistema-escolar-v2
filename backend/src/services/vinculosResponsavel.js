/**
 * vinculosResponsavel — inclusão de responsável vira pedido (Issue #398).
 *
 * Regras:
 *   - e-mail novo enviado pelo responsável NÃO entra na ficha: vira pedido
 *     pendente e não dá acesso nenhum enquanto não for aprovado;
 *   - a secretaria aprova (aí sim o e-mail entra na ficha) ou recusa;
 *   - toda decisão fica no `AuditLog`, e os demais responsáveis do aluno são
 *     avisados da inclusão aprovada — quem já responde pela criança precisa
 *     saber quem passou a ver os dados dela.
 */
const Aluno = require('../models/Aluno');
const SolicitacaoVinculo = require('../models/SolicitacaoVinculo');
const logger = require('../utils/logger');

const lower = (v) =>
    String(v || '')
        .trim()
        .toLowerCase();

/** E-mails que já constam na ficha (principal, dados e lista). */
function emailsDaFicha(aluno) {
    const lista = Array.isArray(aluno?.responsaveis) ? aluno.responsaveis : [];
    return new Set(
        [aluno?.responsavel, aluno?.responsavelDados?.email, ...lista.map((r) => r?.email)]
            .map(lower)
            .filter((e) => e.includes('@'))
    );
}

/** Máscara de e-mail para o log: prova quem foi, sem gravar o endereço. */
function mascarar(email) {
    const [conta, dominio] = String(email).split('@');
    if (!dominio) return '***';
    const visivel = conta.slice(0, 2);
    return `${visivel}${'*'.repeat(Math.max(conta.length - 2, 1))}@${dominio}`;
}

/**
 * Separa, de uma lista enviada pelo responsável, o que é edição do que já
 * existe e o que é inclusão de e-mail novo.
 *
 * @returns {{ conhecidos: object[], novos: object[] }}
 */
function separarNovos(aluno, responsaveisEnviados) {
    const jaNaFicha = emailsDaFicha(aluno);
    const conhecidos = [];
    const novos = [];
    for (const r of responsaveisEnviados || []) {
        const email = lower(r?.email);
        if (email && !jaNaFicha.has(email)) novos.push(r);
        else conhecidos.push(r);
    }
    return { conhecidos, novos };
}

/**
 * Cria (ou reaproveita) o pedido pendente de cada e-mail novo.
 * @returns {Promise<Array<{email: string, status: string}>>}
 */
async function registrarPedidos({ aluno, novos, solicitante }) {
    const criados = [];
    for (const r of novos) {
        const email = lower(r?.email);
        if (!email) continue;
        try {
            const pedido = await SolicitacaoVinculo.findOneAndUpdate(
                { alunoId: String(aluno._id), email, status: 'pendente' },
                {
                    $setOnInsert: {
                        escolaId: aluno.escolaId ? String(aluno.escolaId) : undefined,
                        alunoId: String(aluno._id),
                        solicitanteId: String(solicitante.id || solicitante._id || ''),
                        solicitanteEmail: lower(solicitante.email),
                        email,
                        nome: r?.nome,
                        parentesco: r?.parentesco,
                        telefone: r?.telefone,
                        status: 'pendente',
                    },
                },
                { upsert: true, new: true, setDefaultsOnInsert: true }
            ).lean();
            criados.push({ email, status: pedido.status });
        } catch (e) {
            logger.warn('[Vínculo] Não foi possível registrar o pedido de inclusão', {
                err: e,
                alunoId: String(aluno._id),
                action: 'vinculo.pedido',
            });
        }
    }
    return criados;
}

/** Aplica o pedido aprovado na ficha do aluno. */
async function aplicarNaFicha(aluno, pedido) {
    const lista = Array.isArray(aluno.responsaveis) ? [...aluno.responsaveis] : [];
    if (emailsDaFicha(aluno).has(lower(pedido.email))) return lista;
    lista.push({
        nome: pedido.nome || pedido.email,
        email: pedido.email,
        parentesco: pedido.parentesco,
        telefone: pedido.telefone,
    });
    await Aluno.updateOne({ _id: aluno._id }, { $set: { responsaveis: lista } });
    return lista;
}

/** E-mails que devem ser avisados de uma inclusão aprovada. */
function destinatariosDoAviso(aluno, exceto) {
    const fora = new Set([lower(exceto)]);
    return [...emailsDaFicha(aluno)].filter((e) => !fora.has(e));
}

module.exports = {
    emailsDaFicha,
    separarNovos,
    registrarPedidos,
    aplicarNaFicha,
    destinatariosDoAviso,
    mascarar,
};
