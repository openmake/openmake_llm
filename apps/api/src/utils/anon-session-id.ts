/**
 * 익명 세션 id 형식 판정 (세션 이관 claim 용, 순수 함수).
 *
 * 정식 형식은 UUID v4 다. 예전 웹 클라이언트는 http 접속(비보안 컨텍스트)에서 `crypto.randomUUID` 가 없어
 * `anon-<ms 시각 13자리>-<base36 난수>` 를 만들었다(2026-10-03 이전). 그 브라우저의 게스트 대화는 형식 검증에
 * 막혀 로그인 계정으로 옮겨지지 않았다 — 이 형식도 받는다. 난수 부분이 없는 `anon-<시각>` 은 추측이 쉬워 받지 않는다.
 * 무작위 대입은 종전대로 인증(requireAuth)과 claim 속도 제한이 막는다.
 */
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const LEGACY_WEB_FORMAT = /^anon-\d{13}-[a-z0-9]{8,16}$/;

export function isClaimableAnonSessionId(value: string): boolean {
    return UUID_V4.test(value) || LEGACY_WEB_FORMAT.test(value);
}
