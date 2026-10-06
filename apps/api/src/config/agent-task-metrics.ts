/**
 * 관리자 작업 지표(GET /api/agent-tasks/metrics) 상수 — Companion P5 측정 장치.
 *
 * @module config/agent-task-metrics
 */

export const AGENT_TASK_METRICS = {
    /** 기본 조회 기간(일). */
    DEFAULT_DAYS: 7,
    /** 조회 기간 상한(일) — 이보다 길면 400. */
    MAX_DAYS: 90,
    /** 화면의 기간 선택지(일). */
    DAY_OPTIONS: [7, 30, 90] as readonly number[],
    /** 실패 사유 상위 N. */
    FAILURE_TOP_N: 5,
} as const;
