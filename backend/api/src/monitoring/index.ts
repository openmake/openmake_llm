/**
 * ============================================================
 * Monitoring Module — 통합 진입점 (Barrel)
 * ============================================================
 *
 * Analytics, Alerts, Metrics를 단일 경로로
 * import할 수 있도록 re-export합니다.
 *
 * @example
 * import { getAnalyticsSystem, getAlertSystem, getMetrics } from '../monitoring';
 *
 * @module monitoring
 */

// ── Analytics ────────────────────────────────────────
export {
    AnalyticsSystem,
    getAnalyticsSystem,
} from './analytics';


// ── Alerts ───────────────────────────────────────────
export {
    AlertSystem,
    createAlertSystem,
    getAlertSystem,
} from './alerts';


// ── Metrics ──────────────────────────────────────────
export {
    MetricsCollector,
    getMetrics,
} from './metrics';

export type {
    ChatMetrics,
    Metric,
    MetricStats,
    SystemMetrics,
} from './metrics';
