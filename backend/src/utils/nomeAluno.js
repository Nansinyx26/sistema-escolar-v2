/**
 * nomeAluno.js — normalização de nome próprio.
 *
 * Vive em `utils/` (camada transversal) e não em `services/` por causa do
 * contrato de arquitetura: `models/` pode depender de `utils/`, mas não pode
 * subir para `services/` (regra `model-nao-sobe` do dependency-cruiser). O
 * pre-save de `Aluno` precisa derivar `nomeNormalizado`, e uma segunda cópia
 * da função no model é exatamente como duas normalizações divergem com o
 * tempo — uma grava com acento, a outra sem, e a busca deixa de achar o aluno.
 */

/** Colapsa qualquer sequência de espaço/quebra em UM espaço e apara as pontas. */
function colapsarEspacos(texto) {
    if (texto === null || texto === undefined) return '';
    return String(texto).replace(/\s+/g, ' ').trim();
}

/** Remove diacríticos (NFD + corte da faixa de combining marks). */
function removerAcentos(texto) {
    return String(texto === null || texto === undefined ? '' : texto)
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '');
}

/**
 * Chave de busca e de detecção de duplicata por nome:
 * minúsculo, sem acento, sem espaço duplo.
 */
function normalizarNome(nome) {
    return removerAcentos(colapsarEspacos(nome)).toLowerCase();
}

// Preposições que permanecem em minúscula no Title Case de nome próprio em
// português. "MARIA DAS DORES" → "Maria das Dores", não "Maria Das Dores".
const PREPOSICOES = new Set(['de', 'da', 'do', 'das', 'dos', 'e']);

/**
 * Title Case de nome próprio brasileiro.
 * A primeira palavra nunca vira minúscula, mesmo sendo preposição.
 */
function tituloCase(nome) {
    const limpo = colapsarEspacos(nome);
    if (!limpo) return '';
    return limpo
        .toLocaleLowerCase('pt-BR')
        .split(' ')
        .map((palavra, indice) => {
            if (indice > 0 && PREPOSICOES.has(removerAcentos(palavra))) return palavra;
            // Preserva composto: "SANT'ANA" → "Sant'Ana", "ANA-LUÍSA" → "Ana-Luísa"
            return palavra.replace(
                /(^|[-'])(\p{L})/gu,
                (_, separador, letra) => separador + letra.toLocaleUpperCase('pt-BR')
            );
        })
        .join(' ');
}

module.exports = { colapsarEspacos, removerAcentos, normalizarNome, tituloCase };
