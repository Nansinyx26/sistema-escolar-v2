/**
 * vinculoDoResponsavel.js — quem o responsável alcança nos avisos da escola
 * (Issue #687).
 *
 * Os públicos `todos` e `responsaveis` de um comunicado ou de uma notificação
 * são as famílias DA ESCOLA. Uma conta de responsável sem filho vinculado —
 * criada pelo login Google, por exemplo — era levada à escola ativa única e
 * lia o mural, os comentários e entrava na sala do comunicado. Aqui o vínculo
 * é conferido na escola do aviso, e a mesma regra serve ao mural, à leitura,
 * aos comentários, ao sino e ao Socket.IO.
 */
const Aluno = require('../models/Aluno');
const escapeRegex = require('../utils/escapeRegex');
const { semRestricaoPara } = require('../utils/restricaoAcesso');
const { escolaMatch } = require('../middleware/filtrarPorEscola');

/**
 * Alunos vinculados ao e-mail do responsável (nos três campos da ficha), fora
 * os bloqueados por decisão judicial (Issue #491). Com `escolaId`, só os
 * daquela escola.
 */
async function alunosDoResponsavel(email, escolaId) {
    if (!email) return [];
    const emailRegex = new RegExp(`^${escapeRegex(String(email))}$`, 'i');
    const filtros = [
        {
            $or: [
                { responsavel: emailRegex },
                { 'responsavelDados.email': emailRegex },
                { 'responsaveis.email': emailRegex },
            ],
        },
        semRestricaoPara(email),
    ];
    const daEscola = escolaMatch(escolaId);
    if (Object.keys(daEscola).length) filtros.push(daEscola);
    return Aluno.find({ $and: filtros }).select('turma turmaId id escolaId').lean();
}

/** Destinatários que alcançam os alunos: turma (com e sem prefixo) e ids. */
function destinatariosDosAlunos(alunos) {
    const lista = [];
    for (const a of alunos) {
        const turma = a.turma || a.turmaId;
        if (turma) lista.push(String(turma), `turma:${turma}`);
        lista.push(String(a._id));
        if (a.id) lista.push(String(a.id));
    }
    return lista;
}

/**
 * Destinatários de um aviso da escola `escolaId` que alcançam `user`. A gestão
 * não passa por aqui: ela vê tudo da própria escola.
 */
async function alvosDoUsuario(user, escolaId) {
    const perfil = String(user?.perfil || '').toLowerCase();
    const alvos = [`usuario:${user?.id || user?._id}`];
    if (perfil !== 'responsavel') {
        alvos.push('todos');
        if (perfil === 'professor') alvos.push('professores');
        return alvos;
    }

    const alunos = await alunosDoResponsavel(user.email, escolaId);
    if (!alunos.length) return alvos; // sem filho na escola: só o que é pessoal
    alvos.push('todos', 'responsaveis', ...destinatariosDosAlunos(alunos));
    return alvos;
}

module.exports = { alunosDoResponsavel, destinatariosDosAlunos, alvosDoUsuario };
