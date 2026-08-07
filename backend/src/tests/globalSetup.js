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

    // Opt-in EXPLÍCITO para dispensar o token CSRF nas fixtures.
    // A proteção não depende mais só de NODE_ENV: um ambiente que herde
    // NODE_ENV=test por engano continua com CSRF ativo, porque esta flag
    // existe apenas aqui. Ver middleware/csrfProtection.js.
    process.env.CSRF_DISABLE_FOR_TESTS = 'true';

    // Neutraliza a configuração LOCAL do desenvolvedor. O backend/.env é
    // carregado junto com o app, então uma variável definida na máquina de quem
    // roda os testes mudava o comportamento da suite: com ADMIN_PATH definida,
    // /html/admin passa a responder 404 e as suites do gate quebravam sem que
    // nenhuma linha de código tivesse mudado. Quem testa o apelido define o
    // valor explicitamente no próprio arquivo (paginasAdminApelido.test.js).
    //
    // String vazia, e não `delete`: o dotenv só preenche chaves AUSENTES, então
    // remover a chave deixaria o .env repovoá-la.
    process.env.ADMIN_PATH = '';
};
