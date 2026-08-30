/**
 * serviceWorkerNavegacao.test.js — Issue #127
 *
 * O ramo do `navigationPreload` em `handleNavigation` guardava QUALQUER
 * resposta no PAGES_CACHE, inclusive 404 e 500 — enquanto o ramo de rede, logo
 * abaixo, já checava `.ok`. Como o navigationPreload está habilitado, ele é o
 * caminho normal das navegações em Chrome/Edge: era o caminho normal que não
 * checava.
 *
 * O estrago dura mais que o erro: a página de erro entrava no cache como se
 * fosse o conteúdo daquela URL, e o `catch` passava a devolvê-la sempre que a
 * rede falhasse, em vez de `offline.html`. Um 500 momentâneo do servidor virava
 * estado persistente no aparelho até o próximo bump de `VERSION`.
 *
 * O service worker roda no navegador, então aqui ele é avaliado num contexto
 * `vm` com `caches`, `fetch` e `self` de mentira — as funções de topo viram
 * propriedades do contexto e podem ser chamadas diretamente.
 */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const RAIZ = path.join(__dirname, '../../..');

/** Cache de mentira com a superfície que o service worker usa. */
function criarCaches() {
    const guardados = new Map();
    const caches = {
        _guardados: guardados,
        open: async (nome) => ({
            put: async (req, res) => {
                guardados.set(`${nome}::${chave(req)}`, res);
            },
        }),
        match: async (req) => {
            const alvo = chave(req);
            for (const [k, v] of guardados) if (k.endsWith(`::${alvo}`)) return v;
            return undefined;
        },
        keys: async () => [],
        delete: async () => true,
    };
    return caches;
}

const chave = (req) => (typeof req === 'string' ? req : req.url);

/** Resposta de mentira, com o mínimo que o código toca. */
const resposta = (status, corpo = '', extras = {}) => ({
    status,
    ok: status >= 200 && status < 300,
    type: 'basic',
    clone() {
        return { ...this };
    },
    corpo,
    ...extras,
});

function carregarServiceWorker(caches) {
    const contexto = {
        caches,
        fetch: async () => {
            throw new Error('rede indisponível');
        },
        URL,
        Request: class {},
        Response: class {
            constructor(corpo, init) {
                this.corpo = corpo;
                Object.assign(this, init);
            }
        },
        console,
        setTimeout,
        clearTimeout,
    };
    contexto.self = {
        addEventListener: () => {},
        location: { origin: 'https://escola.exemplo' },
        registration: { navigationPreload: { enable: async () => {} } },
        clients: { claim: async () => {} },
        skipWaiting: () => {},
    };
    vm.createContext(contexto);
    vm.runInContext(fs.readFileSync(path.join(RAIZ, 'service-worker.js'), 'utf8'), contexto);
    return contexto;
}

describe('service worker — cache de navegação (Issue #127)', () => {
    let caches;
    let sw;
    const pedido = { url: 'https://escola.exemplo/html/turma.html?turma=3A', mode: 'navigate' };

    beforeEach(() => {
        caches = criarCaches();
        sw = carregarServiceWorker(caches);
    });

    test('uma navegação 404 pelo preload NÃO entra no cache', async () => {
        const r = await sw.handleNavigation({
            request: pedido,
            preloadResponse: Promise.resolve(resposta(404, 'pagina 404')),
        });

        expect(r.status).toBe(404); // a resposta continua chegando a quem pediu
        expect(caches._guardados.size).toBe(0);
    });

    test('uma navegação 500 pelo preload NÃO entra no cache', async () => {
        await sw.handleNavigation({
            request: pedido,
            preloadResponse: Promise.resolve(resposta(500, 'pagina 500')),
        });

        expect(caches._guardados.size).toBe(0);
    });

    test('uma navegação 200 pelo preload continua sendo cacheada', async () => {
        const r = await sw.handleNavigation({
            request: pedido,
            preloadResponse: Promise.resolve(resposta(200, 'turma')),
        });

        expect(r.status).toBe(200);
        expect(caches._guardados.size).toBe(1);
        expect([...caches._guardados.keys()][0]).toContain('escola-pages-');
    });

    test('um redirecionamento opaco não vira o conteúdo da URL de destino', async () => {
        await sw.handleNavigation({
            request: pedido,
            preloadResponse: Promise.resolve(
                resposta(0, '', { type: 'opaqueredirect', ok: false })
            ),
        });

        expect(caches._guardados.size).toBe(0);
    });

    test('offline numa URL que só respondeu erro antes cai em offline.html', async () => {
        // 1º acesso: o servidor responde 500 e o SW não guarda nada.
        await sw.handleNavigation({
            request: pedido,
            preloadResponse: Promise.resolve(resposta(500, 'pagina 500')),
        });

        // A shell mínima tem o offline.html, como depois de um install normal.
        const cache = await caches.open('escola-static-teste');
        await cache.put('/html/offline.html', resposta(200, 'offline'));

        // 2º acesso, agora sem rede e sem preload.
        const r = await sw.handleNavigation({ request: pedido, preloadResponse: undefined });

        expect(r.corpo).toBe('offline'); // e não a página de erro guardada
    });

    test('o ramo de rede segue com o mesmo critério do preload', async () => {
        sw.fetch = async () => resposta(404, 'pagina 404');

        const r = await sw.handleNavigation({ request: pedido, preloadResponse: undefined });

        // O status prova que passou pelo ramo de rede, e não pelo `catch` —
        // sem isso o teste passaria mesmo com o fetch estourando.
        expect(r.status).toBe(404);
        expect(caches._guardados.size).toBe(0);
    });
});
