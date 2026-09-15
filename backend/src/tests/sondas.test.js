/**
 * sondas.test.js — GET /health e GET /ready (Issue #335)
 *
 * O que estes testes travam:
 *  - /health NÃO depende do banco: uma oscilação do Atlas não pode fazer o
 *    balanceador reiniciar a instância;
 *  - /ready depende do banco E do encerramento;
 *  - as sondas respondem antes de toda a cadeia do app (sem X-Request-Id, que
 *    é posto pelo log de acesso) — não viram ruído nem gastam rate limit.
 */
const request = require('supertest');
const mongoose = require('mongoose');

const app = require('../app');
const prontidao = require('../utils/prontidao');
const { conectarBanco } = require('./helpers');

describe('sondas do balanceador (Issue #335)', () => {
    beforeAll(async () => {
        await conectarBanco();
    });

    beforeEach(() => {
        prontidao._reiniciarParaTeste();
    });

    afterAll(async () => {
        prontidao._reiniciarParaTeste();
        if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
    });

    describe('GET /health', () => {
        test('responde exatamente {"status":"ok"} sem cache', async () => {
            const res = await request(app).get('/health');

            expect(res.status).toBe(200);
            expect(res.body).toEqual({ status: 'ok' });
            expect(res.headers['cache-control']).toBe('no-store');
        });

        test('aceita HEAD, que é o que alguns balanceadores mandam', async () => {
            const res = await request(app).head('/health');
            expect(res.status).toBe(200);
        });

        test('responde antes da cadeia do app: sem X-Request-Id do log de acesso', async () => {
            const sonda = await request(app).get('/health');
            const api = await request(app).get('/api/ping');

            expect(sonda.headers['x-request-id']).toBeUndefined();
            // Controle: a mesma app carimba o id numa rota comum.
            expect(api.headers['x-request-id']).toBeDefined();
        });

        test('continua 200 durante o encerramento — o processo está vivo', async () => {
            prontidao.marcarEncerrando();
            const res = await request(app).get('/health');
            expect(res.status).toBe(200);
        });
    });

    describe('GET /ready', () => {
        test('200 com o banco respondendo', async () => {
            const res = await request(app).get('/ready');

            expect(res.status).toBe(200);
            expect(res.body).toEqual({ status: 'ready', checks: { mongodb: 'ok' } });
            expect(res.headers['cache-control']).toBe('no-store');
        });

        test('503 assim que a instância começa a encerrar, sem esperar o cache', async () => {
            await request(app).get('/ready'); // deixa um "ok" no cache
            prontidao.marcarEncerrando();

            const res = await request(app).get('/ready');

            expect(res.status).toBe(503);
            expect(res.body).toEqual({
                status: 'unavailable',
                checks: { instancia: 'shutting_down' },
            });
        });

        test('não expõe detalhe interno: nem versão, nem memória, nem nome do banco', async () => {
            const res = await request(app).get('/ready');
            const texto = JSON.stringify(res.body);

            expect(texto).not.toMatch(/heap|rss|uptime|version|dbName|mongodb:\/\//i);
        });
    });
});

describe('verificarProntidao — prazo e divisão do ping (Issue #335)', () => {
    beforeAll(async () => {
        await conectarBanco();
    });

    beforeEach(() => {
        prontidao._reiniciarParaTeste();
        jest.restoreAllMocks();
    });

    afterAll(async () => {
        jest.restoreAllMocks();
        if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
    });

    test('ping que não responde dentro do prazo = não pronto', async () => {
        jest.spyOn(mongoose.connection.db, 'admin').mockReturnValue({
            ping: () => new Promise(() => {}), // nunca resolve
        });

        const inicio = Date.now();
        const r = await prontidao.verificarProntidao({ prazoMs: 50, semCache: true });

        expect(r).toEqual({ pronto: false, checks: { mongodb: 'unavailable' } });
        expect(Date.now() - inicio).toBeLessThan(1000);
    });

    test('sondas simultâneas dividem UM ping ao banco', async () => {
        const ping = jest.fn().mockResolvedValue({ ok: 1 });
        jest.spyOn(mongoose.connection.db, 'admin').mockReturnValue({ ping });

        const resultados = await Promise.all([
            prontidao.verificarProntidao(),
            prontidao.verificarProntidao(),
            prontidao.verificarProntidao(),
        ]);

        expect(ping).toHaveBeenCalledTimes(1);
        resultados.forEach((r) => {
            expect(r.pronto).toBe(true);
        });
    });

    test('resultado recente é reaproveitado: a rota pública não vira gerador de consultas', async () => {
        const ping = jest.fn().mockResolvedValue({ ok: 1 });
        jest.spyOn(mongoose.connection.db, 'admin').mockReturnValue({ ping });

        await prontidao.verificarProntidao();
        await prontidao.verificarProntidao();

        expect(ping).toHaveBeenCalledTimes(1);
    });
});

describe('GET /ready com o banco fora (Issue #335)', () => {
    beforeAll(async () => {
        prontidao._reiniciarParaTeste();
        if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
    });

    test('/ready responde 503 e /health continua 200', async () => {
        const pronto = await request(app).get('/ready');
        const vivo = await request(app).get('/health');

        expect(pronto.status).toBe(503);
        expect(pronto.body).toEqual({ status: 'unavailable', checks: { mongodb: 'unavailable' } });
        expect(vivo.status).toBe(200);
        expect(vivo.body).toEqual({ status: 'ok' });
    });
});
