/**
 * rateLimitStoreMongo.test.js — contador de rate limit compartilhado (Issue #333).
 *
 * Duas instâncias do servidor são simuladas por duas instâncias do Store com o
 * mesmo prefixo: é exatamente o que acontece com dois processos apontando para
 * o mesmo banco.
 */
const express = require('express');
const request = require('supertest');
const rateLimit = require('express-rate-limit');
const StoreMongoRateLimit = require('../services/protecaoAbuso/StoreMongoRateLimit');
const RateLimitContador = require('../models/RateLimitContador');
const { conectarBanco, limparBanco, desconectarBanco } = require('./helpers');

beforeAll(async () => {
    await conectarBanco();
});
afterEach(async () => {
    jest.restoreAllMocks();
    await limparBanco();
});
afterAll(async () => {
    await desconectarBanco();
});

function novoStore(nome, windowMs = 60 * 1000) {
    const store = new StoreMongoRateLimit(nome);
    store.init({ windowMs });
    return store;
}

describe('StoreMongoRateLimit', () => {
    it('conta por chave e informa quando a janela acaba', async () => {
        const store = novoStore('teste');
        const antes = Date.now();

        const primeiro = await store.increment('ip:1.1.1.1');
        const segundo = await store.increment('ip:1.1.1.1');
        const outraChave = await store.increment('ip:2.2.2.2');

        expect(primeiro.totalHits).toBe(1);
        expect(segundo.totalHits).toBe(2);
        expect(outraChave.totalHits).toBe(1);
        expect(segundo.resetTime.getTime()).toBeGreaterThanOrEqual(antes + 59 * 1000);
        // A janela é a da PRIMEIRA requisição: incrementar não empurra o fim.
        expect(segundo.resetTime.getTime()).toBe(primeiro.resetTime.getTime());
    });

    it('duas instâncias com o mesmo prefixo somam no mesmo contador', async () => {
        const instanciaA = novoStore('compartilhado');
        const instanciaB = novoStore('compartilhado');

        await instanciaA.increment('ip:9.9.9.9');
        await instanciaB.increment('ip:9.9.9.9');
        const terceiro = await instanciaA.increment('ip:9.9.9.9');

        expect(terceiro.totalHits).toBe(3);
    });

    it('incrementos simultâneos não perdem contagem', async () => {
        const instancias = [novoStore('corrida'), novoStore('corrida'), novoStore('corrida')];
        await Promise.all(
            Array.from({ length: 30 }, (_, i) => instancias[i % 3].increment('ip:8.8.8.8'))
        );
        expect((await instancias[0].get('ip:8.8.8.8')).totalHits).toBe(30);
    });

    it('limitadores diferentes não somam a mesma chave', async () => {
        await novoStore('login').increment('ip:1.1.1.1');
        const chat = await novoStore('chat').increment('ip:1.1.1.1');
        expect(chat.totalHits).toBe(1);
    });

    it('janela vencida recomeça do zero', async () => {
        const store = novoStore('janela');
        await store.increment('ip:1.1.1.1');
        await store.increment('ip:1.1.1.1');
        await RateLimitContador.collection.updateOne(
            { _id: 'janela:ip:1.1.1.1' },
            { $set: { expiraEm: new Date(Date.now() - 1000) } }
        );

        expect(await store.get('ip:1.1.1.1')).toBeUndefined();
        const depois = await store.increment('ip:1.1.1.1');
        expect(depois.totalHits).toBe(1);
        expect(depois.resetTime.getTime()).toBeGreaterThan(Date.now());
    });

    it('decrement devolve uma unidade, sem ficar negativo', async () => {
        const store = novoStore('decremento');
        await store.increment('k');
        await store.increment('k');
        await store.decrement('k');
        expect((await store.get('k')).totalHits).toBe(1);
        await store.decrement('k');
        await store.decrement('k');
        expect((await store.get('k')).totalHits).toBe(0);
    });

    it('resetKey apaga o contador', async () => {
        const store = novoStore('reset');
        await store.increment('k');
        await store.resetKey('k');
        expect(await store.get('k')).toBeUndefined();
    });

    it('o documento tem prazo (TTL) e não guarda nada além da contagem', async () => {
        await novoStore('ttl').increment('ip:1.1.1.1');
        const doc = await RateLimitContador.collection.findOne({ _id: 'ttl:ip:1.1.1.1' });
        expect(Object.keys(doc).sort()).toEqual(['_id', 'expiraEm', 'hits']);
        const indices = await RateLimitContador.collection.indexes();
        expect(indices.some((i) => i.key.expiraEm === 1 && i.expireAfterSeconds === 0)).toBe(true);
    });

    it('banco com erro: conta na memória local em vez de liberar tudo', async () => {
        const store = novoStore('queda');
        jest.spyOn(RateLimitContador.collection, 'findOneAndUpdate').mockRejectedValue(
            new Error('Atlas indisponível')
        );

        // O MemoryStore devolve o mesmo objeto a cada incremento: lê o número na hora.
        const primeiro = (await store.increment('ip:1.1.1.1')).totalHits;
        const segundo = (await store.increment('ip:1.1.1.1')).totalHits;

        expect(primeiro).toBe(1);
        expect(segundo).toBe(2);
    });

    it('funciona como store do express-rate-limit: 429 com Retry-After no teto', async () => {
        const app = express();
        app.use(
            rateLimit({
                windowMs: 60 * 1000,
                limit: 3,
                store: new StoreMongoRateLimit('integracao'),
                standardHeaders: true,
                legacyHeaders: false,
            })
        );
        app.get('/x', (_req, res) => res.json({ ok: true }));

        for (let i = 0; i < 3; i++) {
            expect((await request(app).get('/x')).status).toBe(200);
        }
        const bloqueada = await request(app).get('/x');
        expect(bloqueada.status).toBe(429);
        expect(Number(bloqueada.headers['retry-after'])).toBeGreaterThan(0);
        expect(bloqueada.headers['ratelimit-remaining']).toBe('0');
    });
});
