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
    '/js/libs/bootstrap-icons.min.css',
    '/js/libs/purify.min.js',
    '/js/libs/chart.umd.min.js',
    '/js/libs/sweetalert2.min.js',
    '/js/gsap.min.js',
    '/js/three.min.js'
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

    // Ignora navegações de página (document). Interceptar essas requisições
    // fazia o Service Worker, em caso de qualquer falha/instabilidade de
    // rede, tentar servir o cache de '/index.html' como fallback — o que
    // causava recarregamentos inesperados em páginas como o BI Pedagógico.
    // Navegação de página deve sempre ir direto para a rede.
    if (event.request.mode === 'navigate') {
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
                // Propaga o erro para que a promessa seja rejeitada de forma correta e tratada como falha de rede padrão
                throw err;
            });

            // Retorna do cache se tiver, caso contrário espera a rede
            return cachedResponse || fetchPromise;
        })
    );
});

// Escuta eventos push de notificações
self.addEventListener('push', function(event) {
    let data = { title: 'Escola Jaguari', body: 'Você tem uma nova atualização.' };
    if (event.data) {
        try {
            data = event.data.json();
        } catch (e) {
            data.body = event.data.text();
        }
    }

    const options = {
        body: data.body,
        icon: '/icon-512.png',
        badge: '/icon-512.png',
        vibrate: [100, 50, 100],
        data: {
            url: data.url || '/'
        }
    };

    event.waitUntil(
        self.registration.showNotification(data.title, options)
    );
});

// Ação ao clicar na notificação
self.addEventListener('notificationclick', function(event) {
    event.notification.close();
    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(clientList) {
            const targetUrl = event.notification.data.url;
            for (const client of clientList) {
                if (client.url === targetUrl && 'focus' in client) {
                    return client.focus();
                }
            }
            if (clients.openWindow) {
                return clients.openWindow(targetUrl);
            }
        })
    );
});