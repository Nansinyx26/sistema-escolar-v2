// sw.js — alias do service-worker.js para compatibilidade com o portal do responsável
// O arquivo principal é service-worker.js na raiz do projeto

const CACHE_NAME = 'escola-pwa-v2';

const STATIC_ASSETS = [
    '/',
    '/index.html',
    '/css/login.css',
    '/css/watermark.css',
    '/js/login.js',
    '/js/auth.js',
    '/js/utils.js',
    '/js/api-config.js',
    'https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.3/font/bootstrap-icons.min.css'
];

self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME).then(cache => cache.addAll(STATIC_ASSETS))
    );
    self.skipWaiting();
});

self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(keys =>
            Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
        )
    );
    self.clients.claim();
});

self.addEventListener('fetch', event => {
    if (event.request.method !== 'GET') return;
    if (event.request.url.includes('/api/')) return;

    // Ignora navegações de página — evita fallback indevido para
    // '/index.html' em caso de instabilidade de rede, que causava
    // recarregamentos inesperados.
    if (event.request.mode === 'navigate') return;

    const url = new URL(event.request.url);
    if (url.origin !== self.location.origin) return;

    event.respondWith(
        caches.match(event.request).then(cached => {
            const network = fetch(event.request).then(res => {
                if (res && res.status === 200 && (res.type === 'basic' || res.type === 'cors')) {
                    const clone = res.clone();
                    caches.open(CACHE_NAME).then(c => c.put(event.request, clone));
                }
                return res;
            });
            return cached || network;
        })
    );
});