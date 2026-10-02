const mongoose = require('mongoose');
const { conectarBanco, limparBanco, desconectarBanco } = require('./helpers');
const migration = require('../../migrations/1790785374634-corrigir-localizacao-ciep-philomena');

beforeAll(async () => {
    await conectarBanco();
});
afterAll(async () => {
    await desconectarBanco();
});
beforeEach(async () => {
    await limparBanco();
});

describe('migration da localização da CIEP Profª Philomena Magaly Makluf Rossetti', () => {
    it('corrige somente a escola indicada e pode ser executada novamente', async () => {
        const escolas = mongoose.connection.collection('escolas');
        const alvo = await escolas.insertOne({
            nome: 'CIEP Profª Philomena Magaly Makluf Rossetti',
            tipo: 'CIEP',
            bairro: 'Americana/SP',
            municipio: 'Americana',
        });
        const outra = await escolas.insertOne({
            nome: 'CIEP Outra Escola',
            tipo: 'CIEP',
            bairro: 'Outro bairro',
            municipio: 'Outro município',
        });

        expect((await migration.up()).atualizadas).toBe(1);
        expect(await migration.up()).toEqual({ atualizadas: 0 });
        expect(await escolas.findOne({ _id: alvo.insertedId })).toMatchObject({
            bairro: 'São Vito',
            municipio: 'Americana',
        });
        expect(await escolas.findOne({ _id: outra.insertedId })).toMatchObject({
            bairro: 'Outro bairro',
            municipio: 'Outro município',
        });
    });
});
