/**
 * camposSemFinalidade — campos que saíram do cadastro (Issue #408).
 *
 * `religiao` e `responsabilidadeFinanceira` não alimentam nenhuma função do
 * sistema e não são pedidos pelo Censo nem por outra obrigação da escola
 * pública. Religião ainda é dado sensível (LGPD, art. 11) e quem paga a escola
 * não existe em rede municipal. Fora do schema, o Mongoose já descarta os dois
 * — mas `responsavelDados` é `Mixed`, então nele o descarte é feito aqui,
 * antes da gravação.
 *
 * Cor/raça continua: o Censo Escolar exige.
 */
const CAMPOS_SEM_FINALIDADE = ['religiao', 'responsabilidadeFinanceira'];

/**
 * Remove os campos, em profundidade, do objeto recebido. Altera o próprio
 * objeto (é chamado sobre o corpo já filtrado pela allowlist) e devolve a
 * lista do que foi descartado, para o chamador avisar quem enviou.
 *
 * @param {unknown} valor
 * @param {string[]} [achados]
 * @returns {string[]} caminhos removidos
 */
function limparCamposSemFinalidade(valor, achados = [], prefixo = '') {
    if (Array.isArray(valor)) {
        valor.forEach((item, i) => {
            limparCamposSemFinalidade(item, achados, `${prefixo}[${i}]`);
        });
        return achados;
    }
    if (!valor || typeof valor !== 'object') return achados;
    for (const chave of Object.keys(valor)) {
        const caminho = prefixo ? `${prefixo}.${chave}` : chave;
        if (CAMPOS_SEM_FINALIDADE.includes(chave)) {
            delete valor[chave];
            achados.push(caminho);
            continue;
        }
        limparCamposSemFinalidade(valor[chave], achados, caminho);
    }
    return achados;
}

module.exports = { CAMPOS_SEM_FINALIDADE, limparCamposSemFinalidade };
