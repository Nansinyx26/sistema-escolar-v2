/**
 * Corrige exclusivamente a localização cadastrada da CIEP Profª Philomena
 * Magaly Makluf Rossetti. As telas dinâmicas leem `bairro` e `municipio` do
 * documento Escola, por isso a correção precisa alcançar bases já existentes.
 */
const NOME_ESCOLA = 'CIEP Profª Philomena Magaly Makluf Rossetti';
const LOCALIZACAO_CORRETA = { bairro: 'São Vito', municipio: 'Americana' };

module.exports = {
    version: '1.8',

    async up() {
        const escolas = require('mongoose').connection.db.collection('escolas');
        const resultado = await escolas.updateOne(
            { nome: NOME_ESCOLA },
            { $set: LOCALIZACAO_CORRETA }
        );
        return { atualizadas: resultado.modifiedCount };
    },

    async down() {
        const escolas = require('mongoose').connection.db.collection('escolas');
        const resultado = await escolas.updateOne(
            { nome: NOME_ESCOLA },
            { $set: { bairro: 'Americana/SP' } }
        );
        return { revertidas: resultado.modifiedCount };
    },
};
