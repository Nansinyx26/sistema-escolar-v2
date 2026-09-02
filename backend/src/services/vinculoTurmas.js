/**
 * vinculoTurmas.js — que vínculo REAL liga duas pessoas da escola.
 *
 * Duas perguntas, com dois recortes diferentes: de que TURMAS um professor e um
 * responsável fazem parte, e a que ESCOLAS um responsável está ligado pelos
 * filhos (`vinculoDoResponsavel`). A segunda nasceu com a política que fechou o
 * chat do responsável na secretaria da escola do filho — perfil compatível
 * continua não sendo vínculo, só que agora o recorte é a escola, não a sala.
 *
 * POR QUE O RECORTE POR TURMA EXISTE (Issue #68)
 * ---------------------------------------------
 * A matriz do chat autorizava o PAR DE PERFIS `professor ↔ responsavel` e
 * conferia `escolaId`, mas não olhava vínculo nenhum. Numa escola de 20 turmas,
 * o professor do 1º ano conversava com o responsável de um aluno do 9º que ele
 * nunca viu — todos são "professor" e "responsável" da mesma escola.
 *
 * A autorização correta depende de os dois compartilharem uma turma, e isso
 * exige responder duas perguntas separadas: em que turmas o professor leciona,
 * e em que turmas estão os filhos daquele responsável.
 *
 * Esse par HOJE ESTÁ FECHADO — a família fala com a secretaria, e só (Issue
 * #204, ver `docs/CHAT-PERMISSOES.md`). As três funções de turma continuam aqui,
 * testadas, porque a pergunta que elas respondem não deixou de ser verdadeira:
 * se a política for revista, é este recorte que volta a ser chamado, em vez de
 * ser reescrito de memória.
 *
 * NORMALIZAÇÃO DE TURMA
 * ---------------------
 * O projeto grava turma como texto livre e as duas grafias convivem no banco:
 * "1C" e "1ºC" são a mesma sala. `middleware/horizontalFilter.js` já resolve
 * isso expandindo cada turma nas suas variações, e a lógica aqui é a MESMA de
 * propósito — se as duas divergirem, o chat autoriza um conjunto de turmas e o
 * resto do sistema outro, que é o tipo de bug que ninguém encontra olhando.
 *
 * NÃO CODIFIQUE FAIXA DE SÉRIE AQUI
 * ---------------------------------
 * As duas redes têm alcances diferentes: CIEP vai do 1º ao 5º ano, EMEF vai até
 * o 9º. É tentador usar isso para validar ou montar lista de turmas, e seria
 * errado — a comparação abaixo é entre os TEXTOS das turmas que estão no banco,
 * nunca entre números de série. Por isso ela funciona nos dois tipos de escola
 * sem saber de nenhum deles, e continua funcionando se a rede mudar de faixa.
 * Uma faixa fixa em código só criaria um lugar novo para ficar desatualizado.
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

/**
 * O vínculo de um responsável com a rede: quantos filhos ele tem cadastrados e
 * em quais escolas.
 *
 * POR QUE DUAS INFORMAÇÕES, E NÃO SÓ AS ESCOLAS
 * ---------------------------------------------
 * "Nenhuma escola" é ambíguo, e a ambiguidade decide o veredito do chat:
 *
 *   • responsável SEM filho nenhum        → não tem com quem falar (nega);
 *   • responsável com filho de cadastro   → tem vínculo, mas a escola é
 *     antigo, sem `escolaId`                desconhecida (não dá para recortar
 *                                           por escola, e recortar assim
 *                                           bloquearia a rede pré-migração
 *                                           inteira).
 *
 * Devolver só o `Set` de escolas colapsaria os dois casos no mesmo conjunto
 * vazio. `filhos` é o que os separa.
 *
 * O vínculo responsável→aluno mora em três campos conforme a época do cadastro
 * — mesma razão e mesmo `$or` de `turmasDosFilhos`.
 *
 * @param {string} email e-mail do responsável (da sessão, nunca do cliente)
 * @returns {Promise<{filhos: number, escolas: Set<string>}>}
 */
async function vinculoDoResponsavel(email) {
    const alvo = String(email || '').trim();
    if (!alvo) return { filhos: 0, escolas: new Set() };

    // Âncora e case-insensitive pelo mesmo motivo de `turmasDosFilhos`:
    // `ana@x` não pode casar com `joana@x`, e o cadastro do aluno é digitado
    // à mão, com caixa misturada.
    const regexEmail = new RegExp(`^${escapeRegex(alvo)}$`, 'i');

    const alunos = await Aluno.find({
        $or: [
            { responsavel: regexEmail },
            { 'responsavelDados.email': regexEmail },
            { 'responsaveis.email': regexEmail },
        ],
    })
        .select('escolaId')
        .lean();

    const escolas = new Set();
    for (const aluno of alunos) {
        if (aluno.escolaId) escolas.add(String(aluno.escolaId));
    }
    return { filhos: alunos.length, escolas };
}

/**
 * Varre alunos e junta os e-mails de responsável que encontrar.
 *
 * Devolve em MINÚSCULAS porque é assim que o chamador compara com a conta do
 * responsável, e o cadastro tem grafias misturadas.
 *
 * @param {object} filtro consulta do Mongoose já montada pelo chamador
 * @returns {Promise<Set<string>>}
 */
async function coletarEmailsDeResponsaveis(filtro) {
    const alunos = await Aluno.find(filtro)
        .select('responsavel responsavelDados.email responsaveis.email')
        .lean();

    const emails = new Set();
    const guardar = (valor) => {
        const limpo = String(valor || '')
            .trim()
            .toLowerCase();
        // O campo `responsavel` é texto livre e às vezes guarda o NOME em vez
        // do e-mail. Exigir o "@" descarta esses sem precisar validar formato.
        if (limpo.includes('@')) emails.add(limpo);
    };

    for (const aluno of alunos) {
        guardar(aluno.responsavel);
        guardar(aluno.responsavelDados?.email);
        for (const r of aluno.responsaveis || []) guardar(r?.email);
    }
    return emails;
}

/**
 * E-mails de TODOS os responsáveis da escola.
 *
 * `escolaId` ausente devolve VAZIO, nunca "a rede inteira": sem tenant
 * resolvido a resposta certa é não listar ninguém, e não atravessar escolas.
 *
 * Só faz sentido para a secretaria, que fala com qualquer família da escola
 * dela por definição do papel — professor e direção não alcançam a família
 * pelo chat (ver `MATRIZ_CONVERSA` no ChatDiretoController).
 *
 * @param {string} escolaId
 * @returns {Promise<Set<string>>} e-mails em minúsculas
 */
async function emailsDeResponsaveisDaEscola(escolaId) {
    if (!escolaId) return new Set();
    return coletarEmailsDeResponsaveis({ escolaId: String(escolaId) });
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
    vinculoDoResponsavel,
    emailsDeResponsaveisDaEscola,
    compartilhamTurma,
    variacoesDaTurma,
    expandirTurmas,
};
