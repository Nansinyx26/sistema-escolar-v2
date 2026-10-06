/**
 * Troca o índice único da tabela geral do horário para incluir a escola
 * (Issue #679).
 *
 * O índice antigo era `(turmaId, dia, aulaIdx)`: duas escolas não podiam ter a
 * mesma célula, e a tabela era uma só para a rede. O novo é
 * `(escolaId, turmaId, dia, aulaIdx)`.
 *
 * 1. Célula sem escola vai para a escola ativa, só quando a rede tem EXATAMENTE
 *    uma — mesma regra da migração da #660. Com zero ou mais de uma, não altera
 *    e só conta.
 * 2. O índice novo é criado ANTES de o antigo sair, para não haver janela sem
 *    unicidade. Os dados já são únicos pela chave antiga, então também são pela
 *    nova.
 */
const COLECAO = 'tabela_geral';
const INDICE_ANTIGO = 'turmaId_1_dia_1_aulaIdx_1';
// Mesmo nome do schema (models/TabelaGeral.js): o autoIndex do Mongoose não
// tenta criar um segundo índice com a mesma chave.
const INDICE_NOVO = 'escola_turma_dia_aula_unico';
const SEM_ESCOLA = { $or: [{ escolaId: { $exists: false } }, { escolaId: null }, { escolaId: '' }] };

function ignorarAusente(erro) {
    if (erro.codeName !== 'IndexNotFound' && erro.codeName !== 'NamespaceNotFound') throw erro;
}

module.exports = {
    version: '1.11',

    async up() {
        const db = require('mongoose').connection.db;
        const tabela = db.collection(COLECAO);
        const ativas = await db
            .collection('escolas')
            .find({ ativo: true }, { projection: { _id: 1 } })
            .limit(2)
            .toArray();

        let preenchidas = 0;
        if (ativas.length === 1) {
            ({ modifiedCount: preenchidas } = await tabela.updateMany(SEM_ESCOLA, {
                $set: { escolaId: String(ativas[0]._id) },
            }));
        }
        const semEscola = await tabela.countDocuments(SEM_ESCOLA);

        await tabela.createIndex(
            { escolaId: 1, turmaId: 1, dia: 1, aulaIdx: 1 },
            { name: INDICE_NOVO, unique: true }
        );
        await tabela.dropIndex(INDICE_ANTIGO).catch(ignorarAusente);

        const resultado = { preenchidas, semEscola, indice: INDICE_NOVO };
        console.log(`  … tabela geral: ${JSON.stringify(resultado)}`);
        return resultado;
    },

    // Volta ao índice antigo. Falha (e não remove o novo) se duas escolas já
    // tiverem a mesma célula: aí a chave antiga não é mais única.
    async down() {
        const tabela = require('mongoose').connection.db.collection(COLECAO);
        await tabela.createIndex(
            { turmaId: 1, dia: 1, aulaIdx: 1 },
            { name: INDICE_ANTIGO, unique: true }
        );
        await tabela.dropIndex(INDICE_NOVO).catch(ignorarAusente);
        return { indice: INDICE_ANTIGO };
    },
};
