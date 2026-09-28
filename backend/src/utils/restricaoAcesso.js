/**
 * restricaoAcesso.js — bloqueio de acesso de um responsável por decisão
 * judicial (Issue #491).
 *
 * O acesso do responsável ao aluno é decidido pelo e-mail cadastrado na ficha
 * (`responsavel`, `responsavelDados.email`, `responsaveis[].email`). Um genitor
 * com o acesso restringido pela Justiça (medida protetiva, suspensão ou perda
 * do poder familiar) continuava com acesso enquanto o e-mail estivesse lá.
 *
 * A ficha passa a ter `restricoesAcesso[]`: e-mails que NÃO têm acesso àquele
 * aluno, mesmo constando como responsáveis. A regra vale em todo ponto que
 * reconhece o responsável pelo e-mail — por isso ela mora aqui, e não em cada
 * consulta:
 *
 *   - `semRestricaoPara(email)`: condição para somar às consultas de Aluno por
 *     e-mail do responsável (lista de filhos, turmas, comunicados, salas…);
 *   - `restritoPara(aluno, email)`: a mesma decisão sobre um aluno já lido
 *     (guarda central de acesso).
 *
 * O marcador não guarda texto livre nem detalhe do processo: a decisão fica
 * arquivada na secretaria, e o sistema só precisa saber QUEM não entra.
 */
const MOTIVOS = ['decisao_judicial'];

function normalizarEmail(email) {
    return String(email || '')
        .trim()
        .toLowerCase();
}

/**
 * Condição de consulta: o aluno não tem restrição para este e-mail.
 * Em campo de array, `$ne` exige que NENHUM elemento seja igual — é o que
 * se quer. Aluno sem o campo satisfaz a condição.
 */
function semRestricaoPara(email) {
    return { 'restricoesAcesso.email': { $ne: normalizarEmail(email) } };
}

/** true se a ficha do aluno bloqueia este e-mail. */
function restritoPara(aluno, email) {
    const alvo = normalizarEmail(email);
    if (!alvo || !aluno || !Array.isArray(aluno.restricoesAcesso)) return false;
    return aluno.restricoesAcesso.some((r) => normalizarEmail(r?.email) === alvo);
}

module.exports = { MOTIVOS, normalizarEmail, semRestricaoPara, restritoPara };
