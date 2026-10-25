/**
 * 토큰 무효화 판정(보안 점검 A2) — users.tokens_valid_after(마이그레이션 194) 이전에 발급된 토큰인지.
 *
 * 열이 NULL(기본값)이면 검사하지 않는다 — 기존 토큰 영향 없음. 열이 있는데 iat 가 없으면 발급 시각을 알 수 없으므로 거부.
 * 호출부: auth/middleware.ts(optionalAuth·requireAuth), controllers/auth.controller.ts(refresh).
 * 갱신: data/user-manager-token-invalidation.ts invalidateTokensBefore.
 *
 * @module auth/token-invalidation
 */

/**
 * @param iatSec JWT iat(epoch seconds)
 * @param tokensValidAfter users.tokens_valid_after — ISO 문자열 또는 Date(pg TIMESTAMPTZ)
 * @returns true 면 거부(무효화 시각 이전 발급)
 */
export function isIssuedBeforeInvalidation(iatSec: number | undefined, tokensValidAfter: string | Date | null | undefined): boolean {
    if (tokensValidAfter == null) return false;
    if (iatSec === undefined) return true;
    const validAfterMs = tokensValidAfter instanceof Date ? tokensValidAfter.getTime() : Date.parse(tokensValidAfter);
    return iatSec * 1000 < validAfterMs;
}
