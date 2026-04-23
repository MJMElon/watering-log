const CACHE_VERSION = 'siram-go-v1';

const SHELL_ASSETS = [
    'index.html',
    'signup.html',
    'form.html',
    'records.html',
    'dashboard.html',
    'form.css',
    'form.js',
    'plots.js',
    'sw-register.js',
    'manifest.json',
    'icon-512.png',
    'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2',
    'https://unpkg.com/dexie/dist/dexie.js'
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_VERSION).then((cache) => cache.addAll(SHELL_ASSETS))
    );
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) => Promise.all(
            keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k))
        ))
    );
    self.clients.claim();
});

self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);

    // Skip Supabase database and auth calls — these must always go to network for fresh data.
    // Storage URLs (/storage/...) are allowed through so photos cache after first view.
    if (url.hostname.endsWith('supabase.co') &&
        (url.pathname.startsWith('/rest/') || url.pathname.startsWith('/auth/'))) return;

    // Only handle GETs
    if (event.request.method !== 'GET') return;

    event.respondWith(
        caches.match(event.request).then((cached) => {
            if (cached) return cached;
            return fetch(event.request).then((response) => {
                if (response && response.status === 200 && response.type !== 'opaque') {
                    const clone = response.clone();
                    caches.open(CACHE_VERSION).then((cache) => cache.put(event.request, clone));
                }
                return response;
            }).catch(() => {
                if (event.request.mode === 'navigate') {
                    return caches.match('index.html');
                }
            });
        })
    );
});
