/**
 * turmasDoProfessor.js — as turmas de um professor NUMA escola (Issue #707).
 *
 * O PROBLEMA
 * ----------
 * O professor entra numa segunda escola pela troca por código, e o vínculo
 * novo vai para o MESMO documento `Professor`. As turmas, porém, eram uma
 * lista só (`salaPrincipal`, `salasAdicionais`, `turmas`), sem escola — e o
 * acesso ao aluno compara turma pelo NOME. "1A" existe em quase toda escola:
 * com a escola B ativa, o professor alcançava a 1A de B por dar aula na 1A de
 * A, sem que B tivesse atribuído turma nenhuma a ele.
 *
 * A REGRA
 * -------
 *   - As turmas de cima do documento pertencem à escola do CADASTRO: a do
 *     primeiro vínculo (o que o cadastro cria; a troca por código acrescenta
 *     os seguintes) ou, sem vínculo, o `escolaId` gravado no documento.
 *   - Numa escola de vínculo adicional, as turmas ficam no próprio vínculo
 *     (`vinculos[].turmas`), gravadas pela gestão daquela escola.
 *   - Sem escola resolvida, só quem tem no máximo um vínculo usa as turmas do
 *     cadastro — com dois ou mais não há como saber de qual escola elas são, e
 *     a resposta é nenhuma (falha fechada).
 *
 * Professor de um vínculo só, que é toda a produção hoje, tem exatamente as
 * mesmas turmas de antes.
 *
 * Funções puras sobre o documento (lean ou Mongoose): quem consulta o banco é
 * quem chama, com o `escolaId` da sessão (`req.escolaId`).
 */

function lista(valor) {
    return Array.isArray(valor) ? valor : [];
}

function semRepetir(turmas) {
    return [...new Set(turmas.filter(Boolean).map(String))];
}

/** Turmas gravadas no topo do documento — as da escola do cadastro. */
function turmasDoCadastro(professor) {
    return semRepetir([
        professor.salaPrincipal,
        ...lista(professor.salasAdicionais),
        ...lista(professor.turmas),
    ]);
}

/** Escola dona das turmas de cima, ou null quando o documento não diz. */
function escolaDoCadastro(professor) {
    const vinculos = lista(professor?.vinculos);
    if (vinculos.length > 0 && vinculos[0]?.escolaId) return String(vinculos[0].escolaId);
    return professor?.escolaId ? String(professor.escolaId) : null;
}

/** O vínculo do professor com a escola, se houver. */
function vinculoNaEscola(professor, escolaId) {
    if (!escolaId) return null;
    return lista(professor?.vinculos).find((v) => String(v?.escolaId) === String(escolaId)) || null;
}

/**
 * Turmas em que o professor leciona na escola — nomes como gravados, sem
 * expandir grafias ("1ºA"/"1A" fica com quem compara).
 *
 * @param {object|null} professor documento `Professor`
 * @param {string|null|undefined} escolaId escola ativa da sessão
 * @returns {string[]}
 */
function turmasDoProfessorNaEscola(professor, escolaId) {
    if (!professor) return [];
    const vinculos = lista(professor.vinculos);

    if (!escolaId) return vinculos.length > 1 ? [] : turmasDoCadastro(professor);

    const vinculo = vinculoNaEscola(professor, escolaId);
    if (vinculo && Array.isArray(vinculo.turmas)) return semRepetir(vinculo.turmas);

    const dona = escolaDoCadastro(professor);
    // Legado sem vínculo e sem escola no documento: sistema de escola única.
    if (!dona) return vinculos.length === 0 ? turmasDoCadastro(professor) : [];
    return dona === String(escolaId) ? turmasDoCadastro(professor) : [];
}

/**
 * A gestão desta escola grava as turmas no topo do documento (escola do
 * cadastro) ou no vínculo dela (escola adicional)?
 */
function gravaNoVinculo(professor, escolaId) {
    if (!escolaId) return false;
    const dona = escolaDoCadastro(professor);
    return (
        Boolean(dona) && dona !== String(escolaId) && Boolean(vinculoNaEscola(professor, escolaId))
    );
}

module.exports = {
    turmasDoProfessorNaEscola,
    gravaNoVinculo,
};
