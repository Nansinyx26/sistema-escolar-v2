/**
 * publicoDoComunicado.js — entrega `comunicado:new` só a quem é do público do
 * comunicado (Issue #663).
 *
 * O evento ia para a sala `escola:<id>`, em que estão TODOS os sockets da
 * escola — responsáveis inclusive. Um comunicado só para professores, para uma
 * turma ou para uma família chegava, com título, conteúdo e `_id`, a todos os
 * conectados. As telas usam o próprio objeto do evento para desenhar o card,
 * então o recorte é feito aqui, na origem, e elas não mudam.
 *
 * A regra é a mesma do `podeVerComunicado` (ComunicadoController): a gestão vê
 * tudo; `todos` é a escola; `professores` e `responsaveis` são perfis;
 * `usuario:<id>` é a pessoa; o resto é turma, e vale para os responsáveis dos
 * alunos dela — menos o e-mail bloqueado por decisão judicial (Issue #491).
 */
const Aluno = require('../models/Aluno');
const Professor = require('../models/Professor');
const Usuario = require('../models/Usuario');
const { emitirParaEscola, emitirParaPerfis, emitirParaUsuario } = require('../utils/realtime');
const { restritoPara } = require('../utils/restricaoAcesso');

const EVENTO = 'comunicado:new';
const GESTAO = ['admin', 'diretor', 'secretaria'];
// `diretores` e `diretor` são públicos das notificações (NotificationService).
const PUBLICOS = ['todos', 'professores', 'responsaveis', 'diretores', 'diretor'];

/** Turmas citadas nos destinatários, com ou sem o prefixo `turma:`. */
function turmasDosDestinatarios(destinatarios) {
    return destinatarios
        .filter((d) => !PUBLICOS.includes(d) && !d.startsWith('usuario:'))
        .map((d) => (d.startsWith('turma:') ? d.slice('turma:'.length) : d))
        .filter(Boolean);
}

/**
 * "1A" e "1ºA" são a mesma turma nos cadastros (mesma normalização do
 * `horizontalFilter`).
 */
function variantesDasTurmas(turmas) {
    const lista = new Set();
    for (const t of turmas) {
        const norm = String(t).replace('º', '');
        lista.add(String(t));
        lista.add(norm);
        if (norm.length >= 2) lista.add(`${norm[0]}º${norm.slice(1)}`);
    }
    return [...lista];
}

/** Contas de responsável dos alunos das turmas, na escola. */
async function responsaveisDasTurmas(escolaId, turmas) {
    const nomes = variantesDasTurmas(turmas);
    const alunos = await Aluno.find({
        escolaId: String(escolaId),
        $or: [{ turma: { $in: nomes } }, { turmaId: { $in: nomes } }],
    })
        .select('responsavel responsavelDados.email responsaveis.email restricoesAcesso')
        .lean();

    const emails = new Set();
    for (const aluno of alunos) {
        const candidatos = [
            aluno.responsavel,
            aluno.responsavelDados?.email,
            ...(aluno.responsaveis || []).map((r) => r?.email),
        ];
        for (const email of candidatos) {
            if (email && !restritoPara(aluno, email)) emails.add(String(email).toLowerCase());
        }
    }
    if (!emails.size) return [];

    const contas = await Usuario.find({ email: { $in: [...emails] }, perfil: 'responsavel' })
        .select('_id')
        .lean();
    return contas.map((c) => String(c._id));
}

/** Contas dos professores que dão aula nas turmas, na escola. */
async function professoresDasTurmas(escolaId, turmas) {
    const nomes = variantesDasTurmas(turmas);
    const professores = await Professor.find({
        ativo: { $ne: false },
        $and: [
            { $or: [{ escolaId: String(escolaId) }, { 'vinculos.escolaId': String(escolaId) }] },
            {
                $or: [
                    { salaPrincipal: { $in: nomes } },
                    { salasAdicionais: { $in: nomes } },
                    { turmas: { $in: nomes } },
                ],
            },
        ],
    })
        .select('idUsuario')
        .lean();
    return professores.map((p) => String(p.idUsuario)).filter(Boolean);
}

/**
 * Contas que um aviso endereçado às turmas alcança (Issue #686): os
 * professores delas e, se o aviso for às famílias, os responsáveis dos alunos.
 * Sem escola não há como saber de quem é a turma, e ninguém é alcançado.
 */
async function contasDasTurmas(escolaId, turmas, { incluirResponsaveis = true } = {}) {
    if (!escolaId || !turmas.length) return [];
    const contas = new Set(await professoresDasTurmas(escolaId, turmas));
    if (incluirResponsaveis) {
        for (const id of await responsaveisDasTurmas(escolaId, turmas)) contas.add(id);
    }
    return [...contas];
}

/**
 * Emite `comunicado:new` para o público do comunicado. Não rejeita: o evento é
 * aviso de tela, e o comunicado já foi gravado.
 *
 * @param {object} comunicado documento (Mongoose ou objeto simples)
 * @param {string} [escolaPadrao] escola da sessão, quando o comunicado não tem
 */
async function emitirComunicadoNovo(comunicado, escolaPadrao) {
    try {
        const escolaId = comunicado.escolaId || escolaPadrao;
        const payload =
            typeof comunicado.toObject === 'function' ? comunicado.toObject() : comunicado;
        const destinatarios = (
            Array.isArray(comunicado.destinatarios) ? comunicado.destinatarios : []
        ).map(String);

        if (destinatarios.includes('todos')) {
            emitirParaEscola(escolaId, EVENTO, payload);
            return;
        }
        if (!escolaId) {
            emitirParaEscola(escolaId, EVENTO, payload); // descarta com aviso
            return;
        }

        const perfis = [...GESTAO];
        if (destinatarios.includes('professores')) perfis.push('professor');
        if (destinatarios.includes('responsaveis')) perfis.push('responsavel');
        await emitirParaPerfis(escolaId, perfis, EVENTO, payload);

        // Pessoas fora dos perfis acima: `usuario:<id>` e responsáveis da turma.
        const pessoas = new Set(
            destinatarios
                .filter((d) => d.startsWith('usuario:'))
                .map((d) => d.slice('usuario:'.length))
                .filter(Boolean)
        );
        const turmas = turmasDosDestinatarios(destinatarios);
        if (turmas.length && !perfis.includes('responsavel')) {
            for (const id of await responsaveisDasTurmas(escolaId, turmas)) pessoas.add(id);
        }
        if (!pessoas.size) return;

        // Quem já recebeu pelo perfil não recebe de novo.
        const contas = await Usuario.find({ _id: { $in: [...pessoas] } })
            .select('_id perfil')
            .lean();
        for (const conta of contas) {
            if (!perfis.includes(conta.perfil))
                emitirParaUsuario(String(conta._id), EVENTO, payload);
        }
    } catch (err) {
        console.warn(`[realtime] '${EVENTO}' não entregue: ${err.message}`);
    }
}

module.exports = {
    emitirComunicadoNovo,
    turmasDosDestinatarios,
    contasDasTurmas,
    variantesDasTurmas,
};
