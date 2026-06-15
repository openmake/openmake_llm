/**
 * ============================================================
 * CORS / Origin 정책 (REST + WebSocket 공유 SoT)
 * ============================================================
 *
 * 쿠키(credentials) 기반 인증 환경이므로 와일드카드('*') reflect 는 절대 허용하지 않는다.
 * allowlist 에 정확히 일치하는 Origin 만 reflect 하며, REST 미들웨어와 WS upgrade 검증이
 * 동일한 파싱·매칭 로직을 사용해 정책 불일치(한쪽만 통과/차단)를 방지한다.
 *
 * @module security/cors-policy
 */
import { getConfig } from '../config/env';

/**
 * CORS_ORIGINS(CSV) → 검증된 allowlist.
 * - 빈 항목 제거
 * - 와일드카드('*') 제거 — credentials 환경에서 '*' reflect 는 CORS 스펙상 금지
 * - http(s):// 형식만 허용 (그 외 무시)
 */
export function getCorsAllowlist(): string[] {
    return getConfig().corsOrigins
        .split(',')
        .map((o) => o.trim())
        .filter((o) => o.length > 0 && o !== '*' && /^https?:\/\//i.test(o));
}

/**
 * allowlist 기반 Origin 허용 여부 (WHATWG Origin 스펙 — 대소문자 엄격 정확 비교, 와일드카드 없음).
 * @param origin 요청/upgrade 의 Origin 헤더 값
 * @param allowlist 미지정 시 getCorsAllowlist() 사용
 */
export function isOriginAllowed(origin: string | undefined, allowlist: string[] = getCorsAllowlist()): boolean {
    if (!origin || origin.length === 0) return false;
    return allowlist.includes(origin);
}
