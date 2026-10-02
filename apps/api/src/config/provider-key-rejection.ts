/**
 * @module config/provider-key-rejection
 * @description provider 가 "API 키가 무효·만료" 라고 답했는지 판정 (결정적 패턴 — LLM 판단 없음).
 *
 * 2026-10-03 실측: hasa 는 무효 키에 `403 security_policy_blocked` 를 주고 사유(`invalid_api_key`,
 * "유효하지 않거나 만료된 API Key")는 본문 뒤쪽에 있다. 오류 본문 앞 160자만 전달하던 capability 경로에서는
 * 사유가 잘려, 답변이 "보안 필터에 차단" 으로 안내됐다.
 */
const KEY_REJECTION_PATTERN = /invalid[_ ]api[_ ]key|incorrect api key|api key (?:is )?(?:not valid|invalid|expired)|유효하지 않거나 만료된 API ?Key/i;

/** 판정에 쓰는 본문 길이 상한 — 사유가 뒤쪽에 오는 provider 가 있어 앞부분만 보지 않는다 */
export const KEY_REJECTION_SCAN_CHARS = 4000;

export function isProviderKeyRejection(status: number | undefined, body: string): boolean {
    if (status === 401) return true;
    return KEY_REJECTION_PATTERN.test(body.slice(0, KEY_REJECTION_SCAN_CHARS));
}
