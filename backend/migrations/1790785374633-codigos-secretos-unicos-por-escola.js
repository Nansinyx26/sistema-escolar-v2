/**
 * Garante um código de cadastro exclusivo para cada escola.
 *
 * Antes desta migration o schema não tinha índice único e instalações antigas
 * podiam ter o mesmo `codigoSecreto` em mais de uma escola. Mantém o código da
 * escola ativa mais antiga de cada grupo e gera outro para as demais. Contas
 * existentes não dependem desse campo para login: ele só é usado para novos
 * cadastros e para a prova de vínculo ao trocar de escola.
 */
const crypto = require('node:crypto');

const ALFABETO = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
const NOME_INDICE = 'codigoSecreto_1';

function gerarCodigo(length = 10) {
    let codigo = '';
    for (let i = 0; i < length; i++) codigo += ALFABETO[crypto.randomInt(ALFABETO.length)];
    return codigo;
}

async function gerarCodigoDisponivel(escolas) {
    for (let tentativa = 0; tentativa < 20; tentativa++) {
        const codigo = gerarCodigo();
        if (!(await escolas.findOne({ codigoSecreto: codigo }, { projection: { _id: 1 } }))) {
            return codigo;
        }
    }
    throw new Error('Não foi possível gerar um código secreto exclusivo para a escola.');
}

async function garantirIndiceUnico(escolas) {
    let indiceAtual;
    try {
        indiceAtual = (await escolas.indexes()).find((indice) => indice.name === NOME_INDICE);
    } catch (erro) {
        // Em uma instalação nova a collection ainda não existe. `createIndex`
        // cria a collection junto com o índice, então não há índice legado para
        // reconciliar neste caso.
        if (erro.codeName !== 'NamespaceNotFound') throw erro;
    }
    if (indiceAtual && (!indiceAtual.unique || !indiceAtual.sparse)) {
        await escolas.dropIndex(NOME_INDICE);
    }
    await escolas.createIndex({ codigoSecreto: 1 }, { name: NOME_INDICE, unique: true, sparse: true });
}

module.exports = {
    version: '1.7',

    async up() {
        const escolas = require('mongoose').connection.db.collection('escolas');
        const todas = await escolas
            .find({}, { projection: { _id: 1, codigoSecreto: 1, ativo: 1, criadoEm: 1 } })
            .sort({ ativo: -1, criadoEm: 1, _id: 1 })
            .toArray();

        const codigosPreservados = new Set();
        let atualizadas = 0;
        for (const escola of todas) {
            const codigo = escola.codigoSecreto;
            const invalido = typeof codigo !== 'string' || codigo.trim() === '';
            if (!invalido && !codigosPreservados.has(codigo)) {
                codigosPreservados.add(codigo);
                continue;
            }

            const novoCodigo = await gerarCodigoDisponivel(escolas);
            await escolas.updateOne({ _id: escola._id }, { $set: { codigoSecreto: novoCodigo } });
            codigosPreservados.add(novoCodigo);
            atualizadas++;
        }

        await garantirIndiceUnico(escolas);
        console.log(`  … ${atualizadas} código(s) secreto(s) de escola corrigido(s)`);
        return { atualizadas };
    },

    async down() {
        const escolas = require('mongoose').connection.db.collection('escolas');
        await escolas.dropIndex(NOME_INDICE).catch((erro) => {
            if (erro.codeName !== 'IndexNotFound') throw erro;
        });
        return { indiceRemovido: NOME_INDICE };
    },
};
