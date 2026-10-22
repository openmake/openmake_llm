/**
 * @module config/metrics-exposition
 * @description GET /metrics — 인메모리 MetricsCollector 를 Prometheus 텍스트로 노출(R9-a, 2026-10-22)
 *
 * 기본 OFF(404). 켜면 METRICS_TOKEN 이 있으면 `Authorization: Bearer <토큰>` 만,
 * 비어 있으면 관리자 JWT(서명·role 만 확인, DB 조회 없음)만 받는다.
 */
export const METRICS_EXPOSITION = {
    ENABLED: process.env.METRICS_EXPOSITION_ENABLED === 'true',
    TOKEN: process.env.METRICS_TOKEN ?? '',
} as const;
