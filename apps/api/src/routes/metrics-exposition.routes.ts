/**
 * GET /metrics — 인메모리 MetricsCollector 를 Prometheus 텍스트(0.0.4)로 노출 (R9-a, 2026-10-22)
 *
 * 기본 OFF(404). METRICS_TOKEN 이 있으면 `Authorization: Bearer <토큰>` 을 상수 시간 비교로만 받고,
 * 비어 있으면 /api/health 의 관리자 process 필드와 같은 방식(서명된 JWT 의 role, DB 조회 없음)으로
 * 관리자만 받는다 — 스크레이프가 DB 장애에 묶이지 않게. 토큰 값은 로그에 남기지 않는다.
 */
import { timingSafeEqual } from 'crypto';
import type { Request, RequestHandler, Response } from 'express';
import { extractToken, isAdmin, looksLikeJWT, verifyTokenSignature } from '../auth/auth-core';
import { METRICS_EXPOSITION } from '../config/metrics-exposition';
import { AUTH_COOKIES } from '../config/security';
import { getMetrics } from '../monitoring/metrics';
import { renderPromText } from '../monitoring/prom-exposition';
import { getAgentTaskQueue } from '../services/agent-task/task-queue';
import { notFound, unauthorized } from '../utils/api-response';

function tokenMatches(header: string | undefined, expected: string): boolean {
    if (!header?.startsWith('Bearer ')) return false;
    const given = Buffer.from(header.slice(7));
    const want = Buffer.from(expected);
    return given.length === want.length && timingSafeEqual(given, want);
}

function isAdminRequest(req: Request): boolean {
    // health-process-section.ts 와 같은 순서 — 쿠키(httpOnly) 우선, 다음 Authorization 헤더
    const cookieToken: unknown = req.cookies?.[AUTH_COOKIES.ACCESS];
    const token = typeof cookieToken === 'string' && cookieToken ? cookieToken : extractToken(req.headers.authorization);
    if (!token || !looksLikeJWT(token)) return false;
    const role = verifyTokenSignature(token)?.role;
    return !!role && isAdmin(role);
}

export function createMetricsExpositionHandler(): RequestHandler {
    return (req: Request, res: Response) => {
        if (!METRICS_EXPOSITION.ENABLED) {
            res.status(404).json(notFound('/metrics'));
            return;
        }
        const authorized = METRICS_EXPOSITION.TOKEN
            ? tokenMatches(req.headers.authorization, METRICS_EXPOSITION.TOKEN)
            : isAdminRequest(req);
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
