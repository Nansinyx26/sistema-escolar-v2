/**
 * conexaoBancoSeed.test.js — o seed de desenvolvimento só roda no banco em memória.
 *
 * `connectDB()` rodava `_seedDevData()` depois de QUALQUER conexão com
 * NODE_ENV=development. O seed grava quando acha a coleção vazia — e "vazia" não
 * quer dizer "banco de teste": um banco real ainda sem usuário `professor`
 * ganhava o professor@teste.com, senha 123456.
 *
 * O que estes testes travam:
 *   1. com MONGODB_URI apontando para um banco (qualquer um que não seja o
 *      em memória criado pelo próprio connectDB), nada é semeado;
 *   2. sem MONGODB_URI, o banco em memória continua nascendo populado — é para
 *      isso que o seed existe.
 */
const mongoose = require('mongoose');

jest.mock('../utils/logger', () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    alert: jest.fn(),
    fatal: jest.fn(),
}));

const connectDB = require('../utils/db');

describe('seed de desenvolvimento do connectDB', () => {
    const ambienteOriginal = { ...process.env };

    afterEach(async () => {
        await mongoose.disconnect();
        if (global.__MONGOD__) {
            await global.__MONGOD__.stop();
        }
        delete global.__MONGOD__;
        process.env = { ...ambienteOriginal };
    });

    test('com MONGODB_URI de um banco real, development não grava nada', async () => {
        // O servidor do globalSetup faz o papel de "banco real": ele NÃO é o
        // banco em memória que o connectDB cria para si.
        process.env.NODE_ENV = 'development';
        process.env.MONGODB_URI = ambienteOriginal.MONGODB_URI_TEST;
        process.env.MONGODB_DB_NAME = `seed_real_w${process.env.JEST_WORKER_ID || '1'}`;
        delete global.__MONGOD__;

        await connectDB();

        const db = mongoose.connection.db;
        expect(
            await db.collection('usuarios').countDocuments({ email: 'professor@teste.com' })
        ).toBe(0);
        expect(await db.collection('turmas').countDocuments()).toBe(0);
        expect(await db.collection('alunos').countDocuments()).toBe(0);

        await db.dropDatabase();
    });

    test('sem MONGODB_URI, o banco em memória continua nascendo com o seed', async () => {
        process.env.NODE_ENV = 'development';
        delete process.env.MONGODB_URI;
        delete process.env.MONGODB_DB_NAME;

        await connectDB();

        const db = mongoose.connection.db;
        expect(global.__MONGOD__).toBeDefined();
        expect(
            await db.collection('usuarios').countDocuments({ email: 'professor@teste.com' })
        ).toBe(1);
        expect(await db.collection('turmas').countDocuments()).toBeGreaterThan(0);
    });
});
