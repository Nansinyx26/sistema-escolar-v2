/**
 * globalSetup.js
 * Executado UMA VEZ antes de todas as suites.
 * Sobe um MongoDB in-memory e expõe a URI via process.env.
 */
const { MongoMemoryServer } = require('mongodb-memory-server');

module.exports = async function () {
    const mongod = await MongoMemoryServer.create();
    const uri = mongod.getUri();

    // Injeta a URI para todos os processos de teste via variável de ambiente
    process.env.MONGODB_URI_TEST = uri;
    process.env.MONGODB_URI = uri;

    // Salva referência para o teardown
    global.__MONGOD__ = mongod;

    // Garante segredos mínimos para JWT e CSRF
    process.env.JWT_SECRET = 'test-secret-jwt-for-jest-only';
    process.env.NODE_ENV = 'test';
    process.env.EMAIL_HOST = 'smtp.ethereal.email'; // SMTP falso — não envia nada
};
