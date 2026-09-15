/**
 * conexaoBancoOpcoes.test.js — configuração única da conexão (Issue #335)
 *
 * Pool e timeouts vêm do ambiente com padrão seguro. Uma variável digitada
 * errado não pode derrubar o boot nem abrir um pool sem limite.
 */
const mongoose = require('mongoose');

const connectDB = require('../utils/db');
const { opcoesDeConexao, clienteQuandoConectar, desconectarDB } = connectDB;
const { conectarBanco } = require('./helpers');

describe('opcoesDeConexao (Issue #335)', () => {
    test('padrões: pool limitado e todos os timeouts definidos', () => {
        const o = opcoesDeConexao({});

        expect(o).toEqual({
            maxPoolSize: 20,
            minPoolSize: 0,
            serverSelectionTimeoutMS: 5000,
            connectTimeoutMS: 10000,
            socketTimeoutMS: 45000,
            waitQueueTimeoutMS: 10000,
            appName: 'sistema-escolar-backend',
        });
    });

    test('lê cada valor do ambiente', () => {
        const o = opcoesDeConexao({
            MONGODB_MAX_POOL_SIZE: '50',
            MONGODB_MIN_POOL_SIZE: '2',
            MONGODB_SERVER_SELECTION_TIMEOUT_MS: '8000',
            MONGODB_CONNECT_TIMEOUT_MS: '12000',
            MONGODB_SOCKET_TIMEOUT_MS: '60000',
            MONGODB_WAIT_QUEUE_TIMEOUT_MS: '3000',
            MONGODB_APP_NAME: 'api-instancia-2',
            MONGODB_DB_NAME: 'escola',
        });

        expect(o).toEqual({
            maxPoolSize: 50,
            minPoolSize: 2,
            serverSelectionTimeoutMS: 8000,
            connectTimeoutMS: 12000,
            socketTimeoutMS: 60000,
            waitQueueTimeoutMS: 3000,
            appName: 'api-instancia-2',
            dbName: 'escola',
        });
    });

    test('valor inválido ou abaixo do mínimo cai no padrão, em vez de quebrar o boot', () => {
        const o = opcoesDeConexao({
            MONGODB_MAX_POOL_SIZE: '0',
            MONGODB_SERVER_SELECTION_TIMEOUT_MS: 'rapido',
            MONGODB_SOCKET_TIMEOUT_MS: '-1',
        });

        expect(o.maxPoolSize).toBe(20);
        expect(o.serverSelectionTimeoutMS).toBe(5000);
        expect(o.socketTimeoutMS).toBe(45000);
    });

    test('pool mínimo maior que o máximo é corrigido — o driver recusaria a conexão', () => {
        const o = opcoesDeConexao({ MONGODB_MAX_POOL_SIZE: '5', MONGODB_MIN_POOL_SIZE: '9' });
        expect(o.minPoolSize).toBe(5);
    });

    test('sem MONGODB_DB_NAME não força banco: vale o da connection string', () => {
        expect(opcoesDeConexao({})).not.toHaveProperty('dbName');
    });
});

describe('cliente compartilhado e fechamento (Issue #335)', () => {
    afterAll(async () => {
        if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
    });

    test('clienteQuandoConectar resolve com o MESMO cliente do Mongoose, depois de conectar', async () => {
        const promessa = clienteQuandoConectar(); // pedido antes da conexão, como no app.js
        await conectarBanco();

        const cliente = await promessa;
        expect(cliente).toBe(mongoose.connection.getClient());
        await expect(cliente.db().command({ ping: 1 })).resolves.toMatchObject({ ok: 1 });
    });

    test('desconectarDB fecha a conexão e pode ser chamado de novo sem lançar', async () => {
        // desconectarDB também para o banco em memória do DESENVOLVIMENTO. Aqui
        // ele não pode encostar no banco compartilhado da suíte.
        const mongodDaSuite = global.__MONGOD__;
        delete global.__MONGOD__;
        try {
            await conectarBanco();

            await desconectarDB();
            expect(mongoose.connection.readyState).toBe(0);

            await expect(desconectarDB()).resolves.toBeUndefined();
        } finally {
            if (mongodDaSuite) global.__MONGOD__ = mongodDaSuite;
        }
    });
});
