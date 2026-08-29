/**
 * conexaoBanco.test.js — Issue #126
 *
 * `connectDB` capturava a falha de conexão, logava e agendava a saída. Como a
 * função é `async` e não relançava, `await connectDB()` RESOLVIA COM SUCESSO
 * com o banco fora, e o boot seguia — contra uma conexão que não existe. O
 * processo até morria, mas por corrida de temporizadores, não por fluxo de
 * controle.
 *
 * O que estes testes travam é a promessa: uma falha de conexão REJEITA.
 */
const mongoose = require('mongoose');

jest.mock('mongoose', () => ({
    connect: jest.fn(),
    connection: { on: jest.fn() },
    models: {},
}));

jest.mock('../utils/logger', () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    alert: jest.fn(),
    fatal: jest.fn(),
}));

const logger = require('../utils/logger');
const connectDB = require('../utils/db');

describe('connectDB (Issue #126)', () => {
    const ambienteOriginal = { ...process.env };

    beforeEach(() => {
        jest.clearAllMocks();
        process.env.NODE_ENV = 'production';
        process.env.MONGODB_URI = 'mongodb://host-inalcancavel:27017/escola';
        delete global.__MONGOD__;
    });

    afterAll(() => {
        process.env = ambienteOriginal;
    });

    test('rejeita quando a conexão falha, em vez de resolver', async () => {
        mongoose.connect.mockRejectedValue(new Error('getaddrinfo ENOTFOUND host-inalcancavel'));

        await expect(connectDB()).rejects.toThrow('ENOTFOUND');
    });

    test('o erro continua visível no log antes de sair', async () => {
        mongoose.connect.mockRejectedValue(new Error('connection timed out'));

        await expect(connectDB()).rejects.toThrow();

        expect(logger.alert).toHaveBeenCalledWith(
            'DB_FATAL',
            expect.stringContaining('connection timed out'),
            expect.any(Object)
        );
    });

    test('rejeita quando MONGODB_URI falta em produção', async () => {
        delete process.env.MONGODB_URI;

        await expect(connectDB()).rejects.toThrow('MONGODB_URI');
        expect(mongoose.connect).not.toHaveBeenCalled();
    });

    test('não sai do processo por conta própria — quem chama decide', async () => {
        const sair = jest.spyOn(process, 'exit').mockImplementation(() => {});
        mongoose.connect.mockRejectedValue(new Error('falhou'));

        await expect(connectDB()).rejects.toThrow();

        expect(sair).not.toHaveBeenCalled();
        sair.mockRestore();
    });
});
