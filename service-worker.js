/**
 * service-worker.js — Service Worker principal do Sistema Escolar (PWA)
 *
 * Estratégias:
 *  - Navegações (documentos): network-first com fallback para a própria página
 *    em cache e, por último, para /html/offline.html. NUNCA cai para
 *    '/index.html', o que antes causava recarregamentos indevidos em páginas
 *    como o BI Pedagógico.
 *  - Assets estáticos do mesmo domínio: stale-while-revalidate.
 *  - /api/: nunca interceptado (dados sempre frescos e autenticados).
 */

const VERSION = 'v5';
const STATIC_CACHE = `escola-static-${VERSION}`;
const PAGES_CACHE = `escola-pages-${VERSION}`;
const CURRENT_CACHES = [STATIC_CACHE, PAGES_CACHE];

const OFFLINE_URL = '/html/offline.html';

// Shell mínima. Cada item é cacheado individualmente: um arquivo ausente não
// pode abortar a instalação inteira (era o que acontecia com '/css/login.css',
// que não existe — o Service Worker nunca instalava e, sem SW ativo, o
// navegador não oferecia "Instalar aplicativo").
const STATIC_ASSETS = [
    '/',
    '/index.html',
    OFFLINE_URL,
    '/manifest.json',
    '/css/variables.css',
    '/css/base.css',
    '/css/components-new.css',
    '/css/system-global.css',
    '/css/responsive-global.css',
    '/css/watermark.css',
    '/js/login.js',
    '/js/auth.js',
    '/js/utils.js',
    '/js/api-config.js',
    '/js/theme.js',
    '/js/settings-drawer.js',
    '/js/libs/bootstrap-icons.min.css',
    '/js/libs/purify.min.js',
    '/js/libs/chart.umd.min.js',
    '/js/libs/sweetalert2.min.js',
    '/img/icons/icon-192.png',
    '/img/icons/icon-512.png'
];

async function precache() {
    const cache = await caches.open(STATIC_CACHE);
    await Promise.all(STATIC_ASSETS.map(async (url) => {
        try {
            const res = await fetch(new Request(url, { cache: 'reload' }));
            if (res && res.ok) await cache.put(url, res);
        } catch (err) {
            // Recurso indisponível não impede a instalação do SW.
        }
    }));
}

self.addEventListener('install', (event) => {
    event.waitUntil(precache().then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
    event.waitUntil((async () => {
        const keys = await caches.keys();
        await Promise.all(
            keys.filter((k) => !CURRENT_CACHES.includes(k)).map((k) => caches.delete(k))
        );
        if (self.registration.navigationPreload) {
            try { await self.registration.navigationPreload.enable(); } catch (e) { /* noop */ }
        }
        await self.clients.claim();
    })());
});

// Permite que a página force a ativação de uma nova versão.
self.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

async function handleNavigation(event) {
    try {
        const preload = await event.preloadResponse;
        if (preload) {
            const cache = await caches.open(PAGES_CACHE);
            cache.put(event.request, preload.clone());
            return preload;
        }
        const network = await fetch(event.request);
        if (network && network.ok) {
            const cache = await caches.open(PAGES_CACHE);
            cache.put(event.request, network.clone());
        }
        return network;
    } catch (err) {
        const cached = await caches.match(event.request, { ignoreSearch: true });
        if (cached) return cached;
        const offline = await caches.match(OFFLINE_URL);
        if (offline) return offline;
        return new Response('Você está offline.', {
            status: 503,
            headers: { 'Content-Type': 'text/plain; charset=utf-8' }
        });
    }
}

self.addEventListener('fetch', (event) => {
    const request = event.request;

    if (request.method !== 'GET') return;

    const url = new URL(request.url);

    // API sempre direto para a rede (dados autenticados e voláteis).
    if (url.pathname.startsWith('/api/')) return;

    // Recursos de outros domínios (CDNs) não são gerenciados aqui.
    if (url.origin !== self.location.origin) return;

    if (request.mode === 'navigate') {
        event.respondWith(handleNavigation(event));
        return;
    }

    // Stale-while-revalidate para assets do próprio domínio.
    event.respondWith((async () => {
        const cached = await caches.match(request);
        const networkPromise = fetch(request).then((response) => {
            if (response && response.status === 200 && response.type === 'basic') {
                const clone = response.clone();
                caches.open(STATIC_CACHE).then((cache) => cache.put(request, clone));
            }
            return response;
        });

        if (cached) {
            // Revalida em segundo plano sem deixar rejeição sem tratamento.
            event.waitUntil(networkPromise.catch(() => { }));
            return cached;
        }
        return networkPromise;
    })());
});

// ============================================
// PUSH NOTIFICATIONS
// ============================================
self.addEventListener('push', (event) => {
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
        icon: data.icon || '/img/icons/icon-192.png',
        badge: '/img/icons/icon-96.png',
        vibrate: [100, 50, 100],
        // Reabre a mesma notificação em vez de empilhar duplicatas do mesmo aviso
        tag: (data.data && data.data.id) ? String(data.data.id) : undefined,
        renotify: true,
        data: {
            url: (data.data && data.data.url) || data.url || '/'
        }
    };

    event.waitUntil(self.registration.showNotification(data.title, options));
});

self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
            const targetUrl = event.notification.data.url;
            for (const client of clientList) {
                if (client.url === targetUrl && 'focus' in client) return client.focus();
            }
            if (clients.openWindow) return clients.openWindow(targetUrl);
        })
    );
});
