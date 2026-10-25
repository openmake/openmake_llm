/**
 * 토큰 무효화 판정(보안 점검 A2) — users.tokens_valid_after(마이그레이션 194) 이전에 발급된 토큰인지.
 *
 * 열이 NULL(기본값)이면 검사하지 않는다 — 기존 토큰 영향 없음. 열이 있는데 iat 가 없거나 값이 시각으로 읽히지 않으면
 * 기준을 알 수 없으므로 거부(fail-closed).
 * 비교는 초 단위다 — iat 는 초로 내림이라, ms 로 비교하면 무효화와 같은 초에 새로 발급한 토큰(비밀번호 변경 뒤 이 기기
 * 재발급, 직후 재로그인)까지 거부한다. 같은 초에 무효화 직전 발급된 토큰이 통과하는 최대 1초 창은 iat 정밀도의 trade-off.
 * 호출부: auth/middleware.ts(optionalAuth·requireAuth), controllers/auth.controller.ts(refresh).
 * 갱신: data/user-manager.ts changePassword·updateUser(password, 같은 UPDATE), data/user-manager-token-invalidation.ts
 *       invalidateTokensBefore·updateUsersInvalidatingTokens(부팅 승격).
 *
 * @module auth/token-invalidation
 */

/**
 * @param iatSec JWT iat(epoch seconds)
 * @param tokensValidAfter users.tokens_valid_after — ISO 문자열 또는 Date(pg TIMESTAMPTZ)
 * @returns true 면 거부(무효화 시각이 속한 초보다 이전 발급)
 */
export function isIssuedBeforeInvalidation(iatSec: number | undefined, tokensValidAfter: string | Date | null | undefined): boolean {
    if (tokensValidAfter == null) return false;
    if (iatSec === undefined) return true;
    const validAfterMs = tokensValidAfter instanceof Date ? tokensValidAfter.getTime() : Date.parse(tokensValidAfter);
    if (Number.isNaN(validAfterMs)) return true;
    return iatSec < Math.floor(validAfterMs / 1000);
}
