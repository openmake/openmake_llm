/**
 * Web Push 구독 endpoint 호스트 허용목록 (L2, env override).
 *
 * 등록 시 SSRF 가드(사설/loopback 차단)만으로는 발송 시점 DNS rebinding 창이 남는다
 * (web-push 라이브러리 내부 fetch 라 pinned fetch 불가 — 2026-09-02 보안 리뷰 B7-02).
 * 브라우저 push 서비스는 소수의 알려진 호스트뿐이므로 suffix 허용목록으로 표면을 좁힌다.
 *
 * env `PUSH_ENDPOINT_HOST_ALLOWLIST`: 콤마 구분 호스트 suffix. `*` 는 허용목록 비활성(모든 https 허용).
 */
export const DEFAULT_PUSH_ENDPOINT_HOSTS: readonly string[] = [
    'fcm.googleapis.com',            // Chrome/Android (FCM)
    'android.googleapis.com',        // 구 GCM endpoint
    'push.services.mozilla.com',     // Firefox autopush (updates.push.services.mozilla.com 포함)
    'notify.windows.com',            // Edge (WNS, wns2-*.notify.windows.com)
    'push.apple.com',                // Safari (web.push.apple.com)
];

export function getPushEndpointHostAllowlist(): readonly string[] | null {
    const raw = process.env.PUSH_ENDPOINT_HOST_ALLOWLIST;
    if (raw === undefined || raw.trim() === '') return DEFAULT_PUSH_ENDPOINT_HOSTS;
    if (raw.trim() === '*') return null;
    return raw.split(',').map((h) => h.trim().toLowerCase()).filter(Boolean);
}

/** hostname 이 허용목록 항목과 같거나 그 하위 도메인이면 true. 허용목록 비활성(null)이면 항상 true. */
export function isPushEndpointHostAllowed(hostname: string, allowlist: readonly string[] | null = getPushEndpointHostAllowlist()): boolean {
    if (allowlist === null) return true;
    const h = hostname.toLowerCase();
    return allowlist.some((a) => h === a || h.endsWith(`.${a}`));
}
