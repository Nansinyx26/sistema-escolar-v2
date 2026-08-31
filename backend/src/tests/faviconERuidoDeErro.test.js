/**
 * faviconERuidoDeErro.test.js — Issue #109
 *
 * Duas correções independentes, medidas no mesmo lugar:
 *
 * 1. O handler global chamava `logger.error` para QUALQUER status. Um 404 —
 *    resposta esperada, não falha do servidor — entrava no canal de erro com
 *    stack completo. No job de E2E da execução 33078040754, 6 das 7 linhas
 *    `"level":"error"` eram `GET /favicon.ico` e nenhuma era 5xx de verdade.
 *
 * 2. `favicon.ico` estava declarado em `staticFiles`, mas o arquivo não existe
 *    no repositório. Como o navegador pede `/favicon.ico` por conta própria, o
 *    ENOENT virava uma entrada de erro por visita.
 */
const request = require('supertest');

jest.mock('../utils/logger', () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    alert: jest.fn(),
    fatal: jest.fn(),
    http: jest.fn(),
}));

const logger = require('../utils/logger');
const app = require('../app');

describe('favicon.ico e o canal de erro (Issue #109)', () => {
    beforeEach(() => jest.clearAllMocks());

    test('GET /favicon.ico responde 204, sem corpo e sem erro no log', async () => {
        const res = await request(app).get('/favicon.ico');

        expect(res.status).toBe(204);
        expect(res.text).toBeFalsy();
        expect(logger.error).not.toHaveBeenCalled();
        expect(logger.alert).not.toHaveBeenCalled();
    });

    test('404 de API não entra no canal de erro', async () => {
        await request(app).get('/api/rota-que-nao-existe');

        expect(logger.error).not.toHaveBeenCalled();
        expect(logger.alert).not.toHaveBeenCalled();
    });

    test('um asset inexistente na raiz não gera linha de erro', async () => {
        await request(app).get('/nao-existe-mesmo.png');

        expect(logger.error).not.toHaveBeenCalled();
    });

    test('um 4xx que chega ao handler global vai para warn, não para error', async () => {
        // JSON malformado: o `express.json` lança com `status: 400`, e o erro
        // percorre o handler global — que é o ramo alterado nesta Issue.
        const res = await request(app)
            .post('/api/auth/login')
            .set('Content-Type', 'application/json')
            .send('{isso nao e json');

        expect(res.status).toBe(400);
        expect(logger.error).not.toHaveBeenCalled();
        expect(logger.alert).not.toHaveBeenCalled();
        expect(logger.warn).toHaveBeenCalledWith(
            expect.stringContaining('[Error Handler]'),
            expect.objectContaining({ status: 400, metodo: 'POST' })
        );
    });

    test('5xx continua indo para error E para o alerta — o canal não ficou surdo', () => {
        // O ramo de 5xx é o motivo de o canal existir; o conserto do ruído não
        // pode tê-lo desligado junto. Exercitado direto no handler, porque uma
        // rota que estoure de propósito não existe (e não deveria existir).
        const handler = app._router.stack
            .map((camada) => camada.handle)
            .filter((fn) => typeof fn === 'function' && fn.length === 4)
            .pop();

        const req = { path: '/api/qualquer', method: 'GET', accepts: () => 'json' };
        const res = { status: () => res, json: () => res, set: () => res, end: () => res };
        handler(Object.assign(new Error('explodiu'), { status: 500 }), req, res, () => {});

        expect(logger.error).toHaveBeenCalledWith(
            expect.stringContaining('explodiu'),
            expect.objectContaining({ status: 500 })
        );
        expect(logger.alert).toHaveBeenCalledWith('UNHANDLED_ERROR', 'explodiu', { status: 500 });
    });
});
