/**
 * avisoIndicador.js — o texto que acompanha todo indicador automático sobre
 * aluno (Issue #494).
 *
 * "Alunos em risco", tendência e previsão de nota são estimativas calculadas a
 * partir do que foi lançado. Servem para a equipe olhar primeiro para quem
 * pode precisar de ajuda; não decidem nada sobre a criança — nenhum desses
 * cálculos grava situação, conceito ou encaminhamento no cadastro. A decisão
 * é sempre de uma pessoa da escola, que confere os dados antes.
 *
 * Um texto só, no servidor, para que toda tela diga a mesma coisa.
 */
const AVISO_INDICADOR =
    'Indicador calculado automaticamente a partir de notas e frequência lançadas. ' +
    'Serve de apoio para a equipe: não é avaliação do aluno e não gera decisão sobre ele. ' +
    'Confira os dados antes de agir.';

module.exports = { AVISO_INDICADOR };
