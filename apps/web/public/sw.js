/**
 * OpenMake 웹 푸시 서비스 워커.
 *
 * 배경: 설정 → 알림의 구독 토글은 `navigator.serviceWorker.ready` 를 기다리는데 등록된
 * 서비스 워커가 없어 항상 "서비스 워커가 등록되지 않아 푸시 알림을 사용할 수 없습니다" 였다
 * (2026-09-13 라이브 점검). 백엔드(VAPID·/api/push/*·PushService)는 완비였는데 웹에서
 * 구독 자체가 불가능했다.
 *
 * 의도적으로 **fetch 핸들러를 두지 않는다** — 캐싱/오프라인 동작을 도입하면 Next.js 자산
 * 갱신과 인증 흐름에 영향이 가므로, 이 워커는 푸시 수신·클릭 처리만 한다.
 *
 * 페이로드 계약: PushService.sendPush 의 `{ title, body, url? }` JSON.
 */

self.addEventListener('install', () => {
    // 새 버전을 즉시 활성화 (알림 처리 로직 변경이 다음 방문에 바로 반영되도록)
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
    let payload = {};
    try {
        payload = event.data ? event.data.json() : {};
    } catch {
        // 텍스트로 온 경우 본문으로 취급 (형식 불일치가 알림 자체를 없애지 않게)
        payload = { body: event.data ? event.data.text() : '' };
    }
    const title = payload.title || 'OpenMake';
    const options = {
        body: payload.body || '',
        icon: '/icons/icon-192.png',
        badge: '/icons/icon-192.png',
        // 클릭 시 이동할 앱 내부 경로 (예: /agent-tasks?task=<id>)
        data: { url: typeof payload.url === 'string' ? payload.url : '/' },
        // 같은 작업의 연속 알림이 쌓이지 않게 태그로 합친다
        tag: payload.tag || 'openmake',
        renotify: false,
    };
    event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    const target = (event.notification.data && event.notification.data.url) || '/';
    event.waitUntil((async () => {
        const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
        // 이미 열린 탭이 있으면 그 탭을 재사용 (새 창 남발 방지)
        for (const client of all) {
            if ('focus' in client) {
                await client.focus();
                if ('navigate' in client && target) {
                    try { await client.navigate(target); } catch { /* 크로스 오리진 등 — 포커스만 */ }
                }
                return;
            }
        }
        if (self.clients.openWindow) await self.clients.openWindow(target);
    })());
});
