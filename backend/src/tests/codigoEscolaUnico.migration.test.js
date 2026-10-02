const mongoose = require('mongoose');
const { conectarBanco, limparBanco, desconectarBanco } = require('./helpers');
const { validarCodigoEscola } = require('../services/codigoEscolaService');
const migration = require('../../migrations/1790785374633-codigos-secretos-unicos-por-escola');

beforeAll(async () => {
    await conectarBanco();
});
afterAll(async () => {
    await desconectarBanco();
});
beforeEach(async () => {
    await limparBanco();
});

describe('migration de códigos secretos exclusivos por escola', () => {
    it('cria o índice em uma collection de escolas ainda inexistente', async () => {
        const escolas = mongoose.connection.collection('escolas');
        await escolas.drop().catch((erro) => {
            if (erro.codeName !== 'NamespaceNotFound') throw erro;
        });

        await expect(migration.up()).resolves.toEqual({ atualizadas: 0 });

        const indice = (await escolas.indexes()).find((item) => item.name === 'codigoSecreto_1');
        expect(indice).toMatchObject({ unique: true, sparse: true });
    });

    it('separa duplicados, preenche ausentes e impede uma nova duplicidade', async () => {
        const escolas = mongoose.connection.collection('escolas');
        await escolas.dropIndex('codigoSecreto_1').catch((erro) => {
            if (!['IndexNotFound', 'NamespaceNotFound'].includes(erro.codeName)) throw erro;
        });

        const [ativa, repetida, semCodigo] = await escolas
            .insertMany([
                { nome: 'Escola Ativa', tipo: 'EMEF', ativo: true, codigoSecreto: 'CODIGO-COMUM' },
                {
                    nome: 'Escola Repetida',
                    tipo: 'EMEF',
                    ativo: false,
                    codigoSecreto: 'CODIGO-COMUM',
                },
                { nome: 'Escola Sem Código', tipo: 'EMEF', ativo: false },
            ])
            .then((resultado) => Object.values(resultado.insertedIds));

        const resultado = await migration.up();
        const corrigidas = await escolas
            .find({}, { projection: { nome: 1, codigoSecreto: 1 } })
            .toArray();
        const codigos = corrigidas.map((escola) => escola.codigoSecreto);

        expect(resultado.atualizadas).toBe(2);
        expect(codigos).toHaveLength(3);
        expect(new Set(codigos).size).toBe(3);
        expect((await escolas.findOne({ _id: ativa })).codigoSecreto).toBe('CODIGO-COMUM');
        expect(await validarCodigoEscola('CODIGO-COMUM', String(ativa))).toBeTruthy();
        expect(await validarCodigoEscola('CODIGO-COMUM', String(repetida))).toBe(false);
        expect((await escolas.findOne({ _id: semCodigo })).codigoSecreto).toMatch(
            /^[A-Za-z0-9]{10}$/
        );

        await expect(
            escolas.insertOne({
                nome: 'Tentativa Duplicada',
                tipo: 'EMEF',
                ativo: false,
                codigoSecreto: 'CODIGO-COMUM',
            })
        ).rejects.toMatchObject({ code: 11000 });
    });
});
