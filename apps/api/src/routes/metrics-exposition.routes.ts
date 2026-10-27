/**
 * GET /metrics — 인메모리 MetricsCollector 를 Prometheus 텍스트(0.0.4)로 노출 (R9-a, 2026-10-22)
 *
 * 기본 OFF(404). METRICS_TOKEN 이 있으면 `Authorization: Bearer <토큰>` 을 상수 시간 비교로만 받고(DB 없음),
 * 비어 있으면 /api/health 의 관리자 process 필드와 같은 판정(isAdminRequest — 서명된 JWT 의 role 이 관리자일 때만
 * DB 로 현재 role·is_active·tokens_valid_after 재확인, 조회 실패는 비관리자)으로 관리자만 받는다. 토큰 값은 로그에 남기지 않는다.
 * 켜져 있으면 인증 전에 IP 당 1분 RL_METRICS 한도를 건다(#1477) — 인증 실패 반복도 같은 예산이다.
 */
import { timingSafeEqual } from 'crypto';
import type { Request, RequestHandler, Response } from 'express';
import { METRICS_EXPOSITION } from '../config/metrics-exposition';
import { RL_METRICS } from '../config/rate-limits';
import { createAdvancedRateLimiter } from '../middlewares/rate-limiters';
import { getMetrics } from '../monitoring/metrics';
import { renderPromText } from '../monitoring/prom-exposition';
import { getAgentTaskQueue } from '../services/agent-task/task-queue';
import { notFound, unauthorized } from '../utils/api-response';
import { isAdminRequest } from './health-process-section';

function tokenMatches(header: string | undefined, expected: string): boolean {
    if (!header?.startsWith('Bearer ')) return false;
    const given = Buffer.from(header.slice(7));
    const want = Buffer.from(expected);
    return given.length === want.length && timingSafeEqual(given, want);
}

/** 신원(JWT)을 보지 않고 IP 로만 센다 — 블랙리스트 DB 조회 없음. 꺼져 있으면(기본) 거치지 않아 404 가 그대로 나간다 */
export const metricsScrapeLimiter = createAdvancedRateLimiter({
    name: 'metrics',
    windowMs: RL_METRICS.windowMs,
    ipLimit: RL_METRICS.ipLimit,
    apiKeyActor: false,
    skip: () => !METRICS_EXPOSITION.ENABLED,
    message: '/metrics 요청이 너무 많습니다. 잠시 후 다시 시도하세요.',
}, async () => null);

export function createMetricsExpositionHandler(): RequestHandler {
    return async (req: Request, res: Response) => {
        if (!METRICS_EXPOSITION.ENABLED) {
            res.status(404).json(notFound('/metrics'));
            return;
        }
        const authorized = METRICS_EXPOSITION.TOKEN
            ? tokenMatches(req.headers.authorization, METRICS_EXPOSITION.TOKEN)
            : await isAdminRequest(req);
        if (!authorized) {
            res.status(401).json(unauthorized());
            return;
        }

        const metrics = getMetrics();
        metrics.setGauge('process_uptime_seconds', process.uptime());
        try {
            const q = getAgentTaskQueue().stats();
            metrics.setGauge('agent_task_queue_pending', q.pending);
            metrics.setGauge('agent_task_queue_active', q.globalActive);
            metrics.setGauge('agent_task_queue_oldest_wait_ms', q.wait.oldestPendingMs ?? 0);
        } catch {
            // 큐 스냅샷 실패는 노출을 막지 않는다 — 직전 값(있으면)이 그대로 나간다
        }
        res.type('text/plain; version=0.0.4; charset=utf-8').send(renderPromText(metrics.getAllMetrics()));
    };
}
