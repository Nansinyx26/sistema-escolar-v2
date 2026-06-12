const CACHE_NAME = 'escola-pwa-v2';

// Recursos mínimos para exibir a shell da aplicação offline
const STATIC_ASSETS = [
    '/',
    '/index.html',
    '/css/login.css',
    '/css/watermark.css',
    '/js/login.js',
    '/js/auth.js',
    '/js/utils.js',
    '/js/api-config.js',
    'https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.3/font/bootstrap-icons.min.css',
    'https://cdn.jsdelivr.net/npm/dompurify@3.2.4/dist/purify.min.js'
];

self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME).then(cache => {
            console.log('[ServiceWorker] Fazendo cache dos assets estáticos');
            return cache.addAll(STATIC_ASSETS);
        })
    );
    self.skipWaiting();
});

self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(keys => {
            return Promise.all(
                keys.map(key => {
                    if (key !== CACHE_NAME) {
                        console.log('[ServiceWorker] Removendo cache antigo:', key);
                        return caches.delete(key);
                    }
                })
            );
        })
    );
    self.clients.claim();
});

// Estratégia Stale-While-Revalidate para a maioria das requisições
self.addEventListener('fetch', event => {
    // Ignora requisições não-GET (POST, PUT, DELETE)
    if (event.request.method !== 'GET') {
        return;
    }

    // Ignora requisições para a API
    if (event.request.url.includes('/api/')) {
        return;
    }

    // Ignora requisições cross-origin (CDNs externas como Tailwind, Bootstrap, etc.)
    // O Service Worker só deve cachear recursos do mesmo domínio
    const requestUrl = new URL(event.request.url);
    if (requestUrl.origin !== self.location.origin) {
        return;
    }

    event.respondWith(
        caches.match(event.request).then(cachedResponse => {
            const fetchPromise = fetch(event.request).then(networkResponse => {
                // Atualiza o cache com a versão mais nova da rede (suporta basic e cors)
                if (networkResponse && networkResponse.status === 200 && (networkResponse.type === 'basic' || networkResponse.type === 'cors')) {
                    const responseToCache = networkResponse.clone();
                    caches.open(CACHE_NAME).then(cache => {
                        cache.put(event.request, responseToCache);
                    });
                }
                return networkResponse;
            }).catch(err => {
                // Se falhar a rede e não tiver no cache, tenta retornar o index se for navegação
                if (event.request.mode === 'navigate') {
                    return caches.match('/index.html');
                }
                // Propaga o erro para que a promessa seja rejeitada de forma correta e tratada como falha de rede padrão
                throw err;
            });

            // Retorna do cache se tiver, caso contrário espera a rede
            return cachedResponse || fetchPromise;
        })
    );
});
