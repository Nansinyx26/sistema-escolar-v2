/**
 * vinculoTurmas.js — de que turmas um professor e um responsável fazem parte.
 *
 * POR QUE ISTO EXISTE (Issue #68)
 * ------------------------------
 * A matriz do chat autorizava o PAR DE PERFIS `professor ↔ responsavel` e
 * conferia `escolaId`, mas não olhava vínculo nenhum. Numa escola de 20 turmas,
 * o professor do 1º ano conversava com o responsável de um aluno do 9º que ele
 * nunca viu — todos são "professor" e "responsável" da mesma escola.
 *
 * A autorização correta depende de os dois compartilharem uma turma, e isso
 * exige responder duas perguntas separadas: em que turmas o professor leciona,
 * e em que turmas estão os filhos daquele responsável.
 *
 * NORMALIZAÇÃO DE TURMA
 * ---------------------
 * O projeto grava turma como texto livre e as duas grafias convivem no banco:
 * "1C" e "1ºC" são a mesma sala. `middleware/horizontalFilter.js` já resolve
 * isso expandindo cada turma nas suas variações, e a lógica aqui é a MESMA de
 * propósito — se as duas divergirem, o chat autoriza um conjunto de turmas e o
 * resto do sistema outro, que é o tipo de bug que ninguém encontra olhando.
 *
 * POR QUE EM services/ E NÃO EM utils/
 * -----------------------------------
 * Isto consulta `models/`, e a regra `transversal-nao-desce` do
 * dependency-cruiser proíbe `utils/` de depender de qualquer camada — utils é
 * transversal, e transversal que desce vira ciclo.
 */

const Professor = require('../models/Professor');
const Aluno = require('../models/Aluno');
const escapeRegex = require('../utils/escapeRegex');

/**
 * Expande uma turma nas grafias equivalentes: "1ºC" → {"1ºC", "1C"}.
 * Espelha `addTurma` de middleware/horizontalFilter.js.
 */
function variacoesDaTurma(turma) {
    const saida = new Set();
    const bruta = String(turma || '').trim();
    if (!bruta) return saida;

    saida.add(bruta);
    const semSimbolo = bruta.replace('º', '');
    saida.add(semSimbolo);
    if (semSimbolo.length >= 2) {
        saida.add(`${semSimbolo[0]}º${semSimbolo.slice(1)}`);
    }
    return saida;
}

/** Une as variações de uma lista de turmas num único Set. */
function expandirTurmas(lista) {
    const saida = new Set();
    for (const turma of lista || []) {
        for (const variacao of variacoesDaTurma(turma)) saida.add(variacao);
    }
    return saida;
}

/**
 * Turmas em que o professor leciona.
 *
 * Consolida `salaPrincipal`, `salasAdicionais` e o array helper `turmas` — os
 * três coexistem no cadastro e nenhum sozinho é confiável.
 *
 * @param {string} usuarioId `Usuario._id` do professor
 * @returns {Promise<Set<string>>} vazio quando não há cadastro de professor
 */
async function turmasDoProfessor(usuarioId) {
    const professor = await Professor.findOne({ idUsuario: String(usuarioId) })
        .select('salaPrincipal salasAdicionais turmas')
        .lean();

    // Sem cadastro de professor, nenhuma turma. Falha FECHADA: o efeito é o
    // chat com responsáveis ficar indisponível, nunca liberado por omissão.
    if (!professor) return new Set();

    return expandirTurmas([
        professor.salaPrincipal,
        ...(Array.isArray(professor.salasAdicionais) ? professor.salasAdicionais : []),
        ...(Array.isArray(professor.turmas) ? professor.turmas : []),
    ]);
}

/**
 * Turmas dos alunos vinculados a um responsável.
 *
 * O vínculo responsável→aluno neste projeto é por E-MAIL, e mora em três
 * lugares diferentes conforme a época do cadastro (`responsavel` como texto,
 * `responsavelDados.email` e o array `responsaveis[]`). Consultar só um deles
 * deixaria famílias inteiras de fora — daí o `$or` com os três.
 *
 * @param {string} email e-mail do responsável (da sessão, nunca do cliente)
 * @param {string} [escolaId] escopo multi-tenant
 * @returns {Promise<Set<string>>}
 */
async function turmasDosFilhos(email, escolaId) {
    const alvo = String(email || '').trim();
    if (!alvo) return new Set();

    // Âncora e case-insensitive: e-mail é comparado por igualdade, não por
    // "contém". Sem as âncoras, `ana@x.com` casaria com `joana@x.com`.
    const regexEmail = new RegExp(`^${escapeRegex(alvo)}$`, 'i');

    const filtro = {
        $or: [
            { responsavel: regexEmail },
            { 'responsavelDados.email': regexEmail },
            { 'responsaveis.email': regexEmail },
        ],
    };
    if (escolaId) filtro.escolaId = String(escolaId);

    const alunos = await Aluno.find(filtro).select('turma turmaId').lean();

    const turmas = [];
    for (const aluno of alunos) {
        if (aluno.turma) turmas.push(aluno.turma);
        if (aluno.turmaId) turmas.push(aluno.turmaId);
    }
    return expandirTurmas(turmas);
}

/** true se os dois conjuntos têm ao menos uma turma em comum. */
function compartilhamTurma(turmasA, turmasB) {
    if (!turmasA || !turmasB) return false;
    for (const turma of turmasA) {
        if (turmasB.has(turma)) return true;
    }
    return false;
}

module.exports = {
    turmasDoProfessor,
    turmasDosFilhos,
    compartilhamTurma,
    variacoesDaTurma,
    expandirTurmas,
};
