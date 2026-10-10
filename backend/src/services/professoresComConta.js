/**
 * professoresComConta.js — o professor que o assistente pode citar (Issue #735).
 *
 * O PROBLEMA
 * ----------
 * A direção perguntava "quem é o professor da sala 1B" e recebia nomes que não
 * existem. Duas causas somadas:
 *
 *   1. A turma era comparada pela grafia exata. O banco mistura "1ºB" e "5A";
 *      pedir "1B" não achava ninguém, a ferramenta devolvia lista vazia e o
 *      modelo preenchia o vazio com nomes inventados.
 *   2. Qualquer documento `Professor` contava como professor, tivesse conta ou
 *      não — cadastro órfão, importado ou de teste aparecia como docente real.
 *
 * A REGRA
 * -------
 * Professor citável é o que tem conta (`Usuario`) de perfil professor, ativa e
 * — quando o autocadastro exige — com o e-mail confirmado (Issue #716). O
 * vínculo com a escola continua sendo checado por quem consulta.
 */

const Usuario = require('../models/Usuario');
const { aguardaConfirmacao } = require('./verificacaoEmail');

const OBJECT_ID = /^[a-f\d]{24}$/i;

/**
 * Filtra os documentos `Professor` que têm conta de professor válida.
 *
 * @template {{ idUsuario?: string }} T
 * @param {T[]} professores
 * @returns {Promise<T[]>}
 */
async function soComConta(professores) {
    const lista = Array.isArray(professores) ? professores : [];
    const ids = [
        ...new Set(lista.map((p) => String(p?.idUsuario || '')).filter((id) => OBJECT_ID.test(id))),
    ];
    if (ids.length === 0) return [];

    const contas = await Usuario.find({
        _id: { $in: ids },
        perfil: 'professor',
        ativo: { $ne: false },
    })
        .select('_id confirmacaoEmailObrigatoria emailVerificado')
        .lean();

    const validas = new Set(contas.filter((c) => !aguardaConfirmacao(c)).map((c) => String(c._id)));
    return lista.filter((p) => validas.has(String(p?.idUsuario || '')));
}

/**
 * Chave de comparação de turma: "1B", "1ºB", "1° B", "1º ano B" e "Sala 1B"
 * viram todas "1B".
 *
 * @param {unknown} turma
 * @returns {string}
 */
function chaveDaTurma(turma) {
    return String(turma ?? '')
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .toUpperCase()
        .replace(/[º°ª]/g, '')
        .replace(/\b(ANO|SERIE|TURMA|SALA)\b/g, '')
        .replace(/[\s.\-_/]/g, '');
}

module.exports = { soComConta, chaveDaTurma };
