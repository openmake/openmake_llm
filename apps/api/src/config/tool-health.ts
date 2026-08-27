/**
 * 도구 헬스 관측 설정 (L2).
 *
 * 도구별 실패율 조회의 기본값·상한. 상한은 관리자 UI 가 큰 값을 보내도 집계가 폭주하지
 * 않게 하는 방어선이다(소스 `audit_logs` 는 전 사용자 도구 호출이 쌓이는 테이블).
 *
 * ⚠️ 실패율 상위는 조회 창(days)에 따라 뒤집힌다 — 60일 누계 1위 도구가 30일로는 하위인
 * 사례가 실측됐다(2026-08-28). 창과 최소 표본을 호출자가 정할 수 있어야 하는 이유.
 *
 * @module config/tool-health
 */

/** 도구 헬스 조회 파라미터 기본값·경계. */
export const TOOL_HEALTH_QUERY = {
    /** 기본 조회 기간(일). */
    DEFAULT_DAYS: parseInt(process.env.TOOL_HEALTH_DEFAULT_DAYS || '30', 10),
    /** 조회 가능한 최대 기간(일). */
    MAX_DAYS: parseInt(process.env.TOOL_HEALTH_MAX_DAYS || '180', 10),
    /** 목록에 포함할 최소 호출 수 — 1회 호출 1회 실패(100%)가 상위를 점거하는 것을 막는다. */
    DEFAULT_MIN_CALLS: parseInt(process.env.TOOL_HEALTH_DEFAULT_MIN_CALLS || '3', 10),
    /** minCalls 상한. */
    MAX_MIN_CALLS: parseInt(process.env.TOOL_HEALTH_MAX_MIN_CALLS || '1000', 10),
    /** 기본 반환 도구 수. */
    DEFAULT_LIMIT: parseInt(process.env.TOOL_HEALTH_DEFAULT_LIMIT || '30', 10),
    /** 반환 도구 수 상한. */
    MAX_LIMIT: parseInt(process.env.TOOL_HEALTH_MAX_LIMIT || '200', 10),
} as const;
