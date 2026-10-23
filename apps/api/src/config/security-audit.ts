/**
 * 보안 감사 details 상한 (S10 2026-10-22, 중첩 상한 #1476 2026-10-24).
 *
 * security/security-audit 의 securityAuditDetails 가 audit_logs.details 에 넣기 전에 적용한다.
 * 최상위 계약(문자열 200자·키 20개, undefined 제거)은 그대로이고, 같은 상한을 중첩 객체·배열에도 적용한다.
 * 깊이는 details 객체 자신이 1 — 그보다 깊은 객체·배열은 표식 문자열로 끊는다(원문은 남기지 않는다).
 *
 * @module config/security-audit
 */
export const SECURITY_AUDIT_DETAIL_LIMITS = {
    /** 문자열 값 길이 상한 (capText) */
    TEXT_MAX_CHARS: 200,
    /** 객체 키 개수 상한 — 넘는 키는 버린다(앞에서부터 유지) */
    MAX_KEYS: 20,
    /** 배열 원소 개수 상한 — 넘는 원소는 버린다(앞에서부터 유지) */
    MAX_ARRAY_ITEMS: 20,
    /** 객체·배열 중첩 깊이 상한 (details 자신 = 1) */
    MAX_DEPTH: 3,
    /** 깊이 상한을 넘은 객체·배열 자리에 넣는 고정 표식 */
    DEPTH_MARKER: '[depth-limit]',
    /** 순환 참조 자리에 넣는 고정 표식 */
    CIRCULAR_MARKER: '[circular]',
} as const;
