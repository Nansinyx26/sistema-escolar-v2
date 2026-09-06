/**
 * apiSemCacheCompartilhado.test.js — nenhuma resposta de `/api` pode ser
 * reaproveitada por outra conta.
 *
 * É a causa raiz do defeito "o aceite do diretor valeu para todo mundo": o
 * aceite estava gravado por usuário no banco desde sempre, mas
 * `/api/moderacao/aceite-termo` respondia sem `Cache-Control`. Sem cabeçalho de
 * frescor o navegador aplica cache heurístico e a chave é só a URL — que é a
 * mesma para o diretor, o professor e a secretaria. Numa máquina compartilhada
 * a resposta do primeiro que entrasse servia para os seguintes.
 *
 * O teste cobre o cabeçalho, não a rota: a garantia que importa é a do prefixo
 * inteiro. Um endpoint novo com dado de titular nasce protegido, e é isso que
 * uma checagem por rota não daria.
 *
 * `/api/auth/matriz-acesso` entra como contraprova deliberada: ela devolve
 * dados públicos, define o próprio `Cache-Control` e precisa continuar
 * cacheável. Se o padrão virar uma trava, este caso quebra.
 */

const request = require('supertest');

const app = require('../app');

describe('Cache-Control das respostas de /api', () => {
    it('o padrão do prefixo /api é no-store', async () => {
        // 401 serve tanto quanto 200: o cabeçalho é posto antes de qualquer
        // rota decidir, que é justamente o ponto.
        const res = await request(app).post('/api/auth/login').send({});

        expect(res.headers['cache-control']).toBe('no-store');
    });

    it('a consulta do aceite do Termo nunca é cacheável', async () => {
        const res = await request(app).get('/api/moderacao/aceite-termo');

        expect(res.headers['cache-control']).toBe('no-store');
    });

    it('marca Vary: Cookie — a identidade viaja no cookie do JWT', async () => {
        // Cinto de segurança para qualquer cache que ignore o `no-store`:
        // respostas de sessões diferentes deixam de colidir na mesma chave.
        const res = await request(app).get('/api/moderacao/aceite-termo');

        expect(String(res.headers.vary)).toMatch(/Cookie/i);
    });

    it('quem precisa de cache continua definindo o próprio Cache-Control', async () => {
        const res = await request(app).get('/api/auth/matriz-acesso');

        expect(res.status).toBe(200);
        expect(res.headers['cache-control']).toBe('public, max-age=300');
    });
});
