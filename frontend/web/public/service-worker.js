/**
 * ============================================
 * Service Worker - PWA 오프라인 캐싱 및 푸시 알림
 * ============================================
 * OpenMake.AI PWA의 서비스 워커로, 정적 자산 캐싱,
 * CDN/이미지 캐시 전략, 오프라인 폴백, 푸시 알림을 처리합니다.
 * 캐시 전략: Cache First, Network First, Stale-While-Revalidate.
 *
 * @module service-worker
 */

/** @type {string} 정적 자산 캐시 버전 키 */
const CACHE_VERSION = 'openmake-v10';
/** @type {string} CDN 리소스 캐시 키 */
const CDN_CACHE = 'openmake-cdn-v1';
/** @type {string} 이미지 리소스 캐시 키 */
const IMG_CACHE = 'openmake-img-v1';

const STATIC_ASSETS = [
    '/',
    '/index.html',
    '/login.html',
    '/offline.html',
    '/manifest.json',
    '/logo.png',

    // CSS (12)
    '/style.css',
    '/css/design-tokens.css',
    '/css/icons.css',

    '/css/animations.css',
    '/css/feature-cards.css',
    '/css/unified-sidebar.css',
    '/css/light-theme.css',
    '/css/components.css',
    '/css/layout.css',
    '/css/dark-sidebar.css',
    '/css/pages/dashboard.css',
    '/css/pages/agents.css',

    // JS core (7)
    '/guide_content.js',
    '/js/spa-router.js',
    '/js/main.js',
    '/js/nav-items.js',
    '/js/components/unified-sidebar.js',
    '/js/components/admin-panel.js',
    '/js/components/sidebar.js',
    '/js/components/offline-indicator.js',
    '/js/components/install-prompt.js',

    // JS modules (16)
    '/js/modules/auth.js',
    '/js/modules/chat.js',
    '/js/modules/cluster.js',
    '/js/modules/document.js',
    '/js/modules/error-handler.js',
    '/js/modules/file-upload.js',
    '/js/modules/guide.js',
    '/js/modules/index.js',
    '/js/modules/modes.js',
    '/js/modules/sanitize.js',
    '/js/modules/session.js',
    '/js/modules/settings.js',
    '/js/modules/state.js',
    '/js/modules/ui.js',
    '/js/modules/utils.js',
    '/js/modules/websocket.js',

    // JS page modules (21)
    '/js/modules/pages/admin-metrics.js',
    '/js/modules/pages/admin.js',
    '/js/modules/pages/agent-learning.js',
    '/js/modules/pages/alerts.js',
    '/js/modules/pages/analytics.js',
    '/js/modules/pages/api-keys.js',
    '/js/modules/pages/audit.js',
    '/js/modules/pages/canvas.js',
    '/js/modules/pages/cluster.js',
    '/js/modules/pages/custom-agents.js',
    '/js/modules/pages/developer.js',
    '/js/modules/pages/external.js',
    '/js/modules/pages/guide.js',
    '/js/modules/pages/history.js',
    '/js/modules/pages/marketplace.js',
    '/js/modules/pages/mcp-tools.js',
    '/js/modules/pages/memory.js',
    '/js/modules/pages/password-change.js',
    '/js/modules/pages/research.js',
    '/js/modules/pages/settings.js',

    '/js/modules/pages/usage.js',

    // Icons (10)
    '/icons/icon-72.png',
    '/icons/icon-96.png',
    '/icons/icon-128.png',
    '/icons/icon-144.png',
    '/icons/icon-152.png',
    '/icons/icon-192.png',
    '/icons/icon-384.png',
    '/icons/icon-512.png',
    '/icons/icon-512-maskable.png',
    '/icons/favicon.png'
];

/** @type {string[]} CDN 호스트 목록 (stale-while-revalidate 전략 적용) */
const CDN_HOSTS = ['cdn.jsdelivr.net', 'cdnjs.cloudflare.com', 'fonts.googleapis.com', 'fonts.gstatic.com'];
/** @type {number} CDN 캐시 최대 항목 수 */
const MAX_CDN_ENTRIES = 50;
/** @type {number} 이미지 캐시 최대 항목 수 */
const MAX_IMG_ENTRIES = 100;

// ========== Install ==========
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_VERSION)
            .then((cache) => {
                // Cache assets individually to avoid one failure breaking all
                return Promise.allSettled(
                    STATIC_ASSETS.map(url =>
                        cache.add(url).catch(err => {
                            console.warn('[SW] 캐시 실패:', url, err.message);
                        })
                    )
                );
            })
            .then(() => self.skipWaiting())
    );
});

// ========== Activate ==========
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys()
            .then((names) => Promise.all(
                names
                    .filter(n => n !== CACHE_VERSION && n !== CDN_CACHE && n !== IMG_CACHE)
                    .map(n => caches.delete(n))
            ))
            .then(() => self.clients.claim())
            .then(() => {
                // Notify all clients about the update
                return self.clients.matchAll({ type: 'window' }).then(clients => {
                    clients.forEach(client => {
                        client.postMessage({ type: 'SW_UPDATED', version: CACHE_VERSION });
                    });
                });
            })
    );
});

// ========== Fetch ==========
self.addEventListener('fetch', (event) => {
    const { request } = event;
    const url = new URL(request.url);

    // Skip non-GET requests
    if (request.method !== 'GET') return;

    // Skip WebSocket
    if (url.protocol === 'ws:' || url.protocol === 'wss:') return;

    // API requests — network only (real-time, auth-dependent)
    if (url.pathname.startsWith('/api/')) {
        event.respondWith(networkOnly(request));
        return;
    }

    // CDN resources — stale-while-revalidate
    if (CDN_HOSTS.some(host => url.hostname === host || url.hostname.endsWith('.' + host))) {
        event.respondWith(staleWhileRevalidate(request, CDN_CACHE, MAX_CDN_ENTRIES));
        return;
    }

    // HTML/navigation requests — network first with offline fallback
    if (request.mode === 'navigate' || request.destination === 'document' ||
        url.pathname.endsWith('.html') || url.pathname === '/') {
        event.respondWith(networkFirstWithOffline(request));
        return;
    }

    // Images — cache first with lazy population
    if (/\.(png|jpg|jpeg|svg|gif|webp|ico)$/i.test(url.pathname) ||
        request.destination === 'image') {
        event.respondWith(cacheFirstLazy(request, IMG_CACHE, MAX_IMG_ENTRIES));
        return;
    }

    // Static assets (JS, CSS, etc.) — stale-while-revalidate for fresh deployments
    event.respondWith(staleWhileRevalidate(request, CACHE_VERSION, 100));
});

// ========== Strategies ==========

/**
 * Cache First 전략 - 캐시 우선 조회, 없으면 네트워크 요청 후 캐시 저장
 * @param {Request} request - Fetch 요청 객체
 * @returns {Promise<Response>} 응답 객체
 */
async function cacheFirst(request) {
    const cached = await caches.match(request);
    if (cached) return cached;

    try {
        const response = await fetch(request);
        if (response.ok) {
            const cache = await caches.open(CACHE_VERSION);
            cache.put(request, response.clone());
        }
        return response;
    } catch (err) {
        return new Response('Offline', { status: 503, statusText: 'Service Unavailable' });
    }
}

/**
 * Cache First Lazy 전략 - 캐시 우선 + 지연 캐시 저장 + 자동 트림
 * @param {Request} request - Fetch 요청 객체
 * @param {string} cacheName - 캐시 저장소 이름
 * @param {number} maxItems - 캐시 최대 항목 수
 * @returns {Promise<Response>} 응답 객체
 */
async function cacheFirstLazy(request, cacheName, maxItems) {
    const cached = await caches.match(request);
    if (cached) return cached;

    try {
        const response = await fetch(request);
        if (response.ok) {
            const cache = await caches.open(cacheName);
            cache.put(request, response.clone());
            trimCache(cacheName, maxItems);
        }
        return response;
    } catch (err) {
        return new Response('', { status: 503 });
    }
}

/**
 * Network First 전략 - 네트워크 우선, 실패 시 캐시/SPA 셸/오프라인 페이지 폴백
 * @param {Request} request - Fetch 요청 객체
 * @returns {Promise<Response>} 응답 객체
 */
async function networkFirstWithOffline(request) {
    try {
        const response = await fetch(request);
        if (response.ok) {
            const cache = await caches.open(CACHE_VERSION);
            cache.put(request, response.clone());
        }
        return response;
    } catch (err) {
        const cached = await caches.match(request);
        if (cached) return cached;

        // For SPA routes, return cached index.html (SPA shell)
        const shell = await caches.match('/index.html');
        if (shell) return shell;

        // Last resort: offline page
        const offline = await caches.match('/offline.html');
        if (offline) return offline;

        return new Response('오프라인', { status: 503 });
    }
}

/**
 * Stale-While-Revalidate 전략 - 캐시된 응답 즉시 반환 + 백그라운드 갱신
 * @param {Request} request - Fetch 요청 객체
 * @param {string} cacheName - 캐시 저장소 이름
 * @param {number} maxItems - 캐시 최대 항목 수
 * @returns {Promise<Response>} 응답 객체
 */
async function staleWhileRevalidate(request, cacheName, maxItems) {
    const cache = await caches.open(cacheName);
    const cached = await cache.match(request);

    const fetchPromise = fetch(request)
        .then(response => {
            if (response.ok) {
                cache.put(request, response.clone());
                trimCache(cacheName, maxItems);
            }
            return response;
        })
        .catch(() => cached);

    return cached || fetchPromise;
}

/**
 * Network Only 전략 - 네트워크 전용 (API 요청 등 실시간 데이터용)
 * @param {Request} request - Fetch 요청 객체
 * @returns {Promise<Response>} 응답 객체
 */
async function networkOnly(request) {
    try {
        return await fetch(request);
    } catch (err) {
        return new Response(JSON.stringify({ error: '오프라인 상태입니다.' }), {
            status: 503,
            headers: { 'Content-Type': 'application/json' }
        });
    }
}

// ========== Cache Management ==========

/**
 * 캐시 트림 - 최대 항목 수 초과 시 오래된 항목부터 삭제 (FIFO)
 * @param {string} cacheName - 캐시 저장소 이름
 * @param {number} maxItems - 유지할 최대 항목 수
 * @returns {Promise<void>}
 */
async function trimCache(cacheName, maxItems) {
    const cache = await caches.open(cacheName);
    const keys = await cache.keys();
    if (keys.length > maxItems) {
        // Delete oldest entries (FIFO)
        const toDelete = keys.slice(0, keys.length - maxItems);
        await Promise.all(toDelete.map(key => cache.delete(key)));
    }
}

// ========== Push Notifications ==========
self.addEventListener('push', (event) => {
    if (!event.data) return;

    try {
        const data = event.data.json();
        event.waitUntil(
            self.registration.showNotification(data.title || 'OpenMake.Ai', {
                body: data.body || '',
                icon: '/icons/icon-192.png',
                badge: '/icons/icon-72.png',
                tag: data.tag || 'openmake-notification',
                data: { url: data.url || '/' },
                requireInteraction: false
            })
        );
    } catch (e) {
        console.error('[SW] Push parse error:', e);
    }
});

self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    const targetUrl = event.notification.data?.url || '/';

    event.waitUntil(
        self.clients.matchAll({ type: 'window', includeUncontrolled: true })
            .then((clientList) => {
                for (const client of clientList) {
                    if (client.url.includes(self.location.origin) && 'focus' in client) {
                        client.navigate(targetUrl);
                        return client.focus();
                    }
                }
                return self.clients.openWindow(targetUrl);
            })
    );
});
