/**
 * Push Service Worker — web push 알림 수신 전용.
 * (service-worker.js 는 self-destruct 용이라 별도 파일로 분리)
 */
self.addEventListener('push', (event) => {
    let data = {};
    try { data = event.data ? event.data.json() : {}; } catch (e) { data = {}; }
    const title = data.title || 'OpenMake';
    event.waitUntil(
        self.registration.showNotification(title, {
            body: data.body || '',
            icon: '/favicon.ico',
            data: { url: data.url || '/' },
        })
    );
});

self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    const url = (event.notification.data && event.notification.data.url) || '/';
    event.waitUntil(
        self.clients.matchAll({ type: 'window' }).then((clients) => {
            for (const c of clients) {
                if (c.url.indexOf(url) !== -1 && 'focus' in c) return c.focus();
            }
            if (self.clients.openWindow) return self.clients.openWindow(url);
        })
    );
});
