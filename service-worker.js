const CACHE_VERSION = 'siram-go-v99';

const SHELL_ASSETS = [
    'index.html',
    'signup.html',
    'form.html',
    'records.html',
    'dashboard.html',
    'payroll.html',
    'form.css',
    'form.js',
    'plots.js',
    'nav.js',
    'payroll_config.js',
    'sw-register.js',
    'manifest.json',
    'icon-512.png',
    'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2',
    'https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js',
    'https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js',
    'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js',
    'https://unpkg.com/dexie/dist/dexie.js'
];

// Same-origin app code. Fetched network-first so an installed PWA cannot keep
// serving a stale records.html / nav.js the way siram-go-v97 cache-first did.
// service-worker.js is listed so an intercepted copy of this script is not sticky.
const APP_SHELL_FILES = new Set(
    SHELL_ASSETS.filter((asset) => asset.indexOf('://') === -1).concat(['service-worker.js'])
);

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

function isSameOriginAppShell(request, url) {
    if (url.origin !== self.location.origin) return false;
    const file = url.pathname.slice(url.pathname.lastIndexOf('/') + 1);
    if (APP_SHELL_FILES.has(file)) return true;
    // GitHub Pages project root (…/watering-log/) navigates to index.html.
    return request.mode === 'navigate';
}

// 'passthrough' — do not call respondWith (browser talks to the network).
// 'network-first' — same-origin shell HTML/JS/CSS while online, cache if offline.
// 'cache-first' — photos, vendor CDN, and any other GET.
function fetchStrategy(request, url) {
    // Only handle http(s) — skip chrome-extension://, data:, blob:, etc.
    // The Cache API rejects non-http(s) schemes with a TypeError.
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return 'passthrough';

    // Skip Supabase database and auth calls — these must always go to network for fresh data.
    // Storage URLs (/storage/...) are allowed through so photos cache after first view.
    if (url.hostname.endsWith('supabase.co') &&
        (url.pathname.startsWith('/rest/') || url.pathname.startsWith('/auth/'))) return 'passthrough';

    // Only handle GETs
    if (request.method !== 'GET') return 'passthrough';

    if (isSameOriginAppShell(request, url)) return 'network-first';
    return 'cache-first';
}

function storeIfCacheable(request, response) {
    if (response && response.status === 200 && response.type !== 'opaque') {
        const clone = response.clone();
        caches.open(CACHE_VERSION).then((cache) => cache.put(request, clone)).catch(() => { /* unsupported scheme or quota */ });
    }
}

// Online: use the network response and refresh the cache.
// Offline (or a failed network): serve the cached shell, then index.html for navigations.
function networkFirstShell(request) {
    return fetch(request).then((response) => {
        if (response && response.ok) {
            storeIfCacheable(request, response);
            return response;
        }
        return caches.match(request).then((cached) => cached || response);
    }).catch(() => caches.match(request).then((cached) => {
        if (cached) return cached;
        if (request.mode === 'navigate') return caches.match('index.html');
    }));
}

// Cached photo or vendor script wins. A miss is fetched and stored on 200.
function cacheFirst(request) {
    return caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request).then((response) => {
            storeIfCacheable(request, response);
            return response;
        }).catch(() => {
            if (request.mode === 'navigate') return caches.match('index.html');
        });
    });
}

self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);
    const strategy = fetchStrategy(event.request, url);
    if (strategy === 'passthrough') return;

    if (strategy === 'network-first') {
        event.respondWith(networkFirstShell(event.request));
        return;
    }

    // Photos on /storage/..., vendor CDN scripts, and other GETs stay cache-first.
    event.respondWith(cacheFirst(event.request));
});
