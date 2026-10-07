/**
 * Põe na escola ativa as atribuições e as frequências de professor gravadas
 * sem escola (Issue #660).
 *
 * As rotas `/atribuicoes` e `/frequencia-professores` eram montadas sem
 * `filtrarPorEscola`, então parte dos registros foi gravada sem `escolaId`.
 * Com o filtro de escola, esses registros sumiriam da tela da escola que os
 * criou — e a atribuição seria recriada em branco pelo auto-ajuste da lista.
 *
 * Só age quando a rede tem EXATAMENTE uma escola ativa: aí não há dúvida de
 * quem gravou. Com zero ou mais de uma, não altera nada e só conta — atribuir
 * a escola por palpite seria pior que deixar o registro de fora.
 */
const SEM_ESCOLA = { $or: [{ escolaId: { $exists: false } }, { escolaId: null }, { escolaId: '' }] };
const COLECOES = ['atribuicoes_professores', 'frequencia_professores'];

module.exports = {
    version: '1.10',

    async up() {
        const db = require('mongoose').connection.db;
        const ativas = await db
            .collection('escolas')
            .find({ ativo: true }, { projection: { _id: 1 } })
            .limit(2)
            .toArray();

        const resultado = {};
        for (const nome of COLECOES) {
            const colecao = db.collection(nome);
            if (ativas.length !== 1) {
                resultado[nome] = { semEscola: await colecao.countDocuments(SEM_ESCOLA), atualizados: 0 };
                continue;
            }
            const { modifiedCount } = await colecao.updateMany(SEM_ESCOLA, {
                $set: { escolaId: String(ativas[0]._id) },
            });
            resultado[nome] = { atualizados: modifiedCount };
        }

        console.log(
            ativas.length === 1
                ? `  … escola ativa única: ${JSON.stringify(resultado)}`
                : `  … ${ativas.length} escolas ativas, nada alterado: ${JSON.stringify(resultado)}`
        );
        return resultado;
    },

    // Não há como saber quais registros estavam sem escola antes; e devolvê-los
    // a esse estado só os tiraria da tela da escola de novo.
    async down() {},
};
