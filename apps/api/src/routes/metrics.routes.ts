/**
 * ============================================================
 * Metrics Routes - 시스템 메트릭 및 모니터링 API 라우트
 * ============================================================
 *
 * 시스템 성능 메트릭, API 사용량, 분석 대시보드, 알림 히스토리,
 * 캐시 통계, 연결 풀 상태, 헬스 체크 등 운영 모니터링 전반을
 * 제공합니다. 모든 엔드포인트는 관리자(admin) 전용입니다.
 *
 * @module routes/metrics.routes
 * @description
 * - GET  /api/metrics               - 시스템 메트릭 (채팅, 시스템, 클러스터, 에이전트, 사용량)
 * - GET  /api/metrics/metrics       - 상세 시스템 메트릭 (CPU, 메모리, 캐시)
 * - GET  /api/metrics/usage         - API 사용량 요약
 * - GET  /api/metrics/usage/daily   - 일별 사용량
 * - GET  /api/metrics/analytics     - 종합 분석 대시보드
 * - GET  /api/metrics/analytics/agents   - 에이전트 성능 분석
 * - GET  /api/metrics/analytics/behavior - 사용자 행동 분석
 * - GET  /api/metrics/analytics/cost     - 비용 분석
 * - GET  /api/metrics/alerts        - 알림 히스토리
 * - GET  /api/metrics/cache/stats   - 캐시 통계
 * - POST /api/metrics/cache/clear   - 캐시 초기화
 * - GET  /api/metrics/pool/stats    - 연결 풀 통계
 * - GET  /api/metrics/health        - 시스템 헬스 체크
 *
 * @requires requireAuth - JWT 인증 미들웨어
 * @requires requireAdmin - 관리자 권한 미들웨어
 * @requires ApiUsageTracker - API 사용량 추적기
 * @requires AnalyticsSystem - 분석 시스템
 * @requires AlertSystem - 알림 시스템
 */

import { Router, Request, Response } from 'express';
import { getApiUsageTracker } from '../llm';
import { getCacheSystem } from '../cache';
import { getAlertSystem } from '../monitoring/alerts';
import { getAnalyticsSystem } from '../monitoring/analytics';
import { ClusterManager } from '../cluster/manager';
import { getAgentMonitor } from '../agents';
import * as os from 'os';
import { success } from '../utils/api-response';
import { requireAuth, requireAdmin } from '../auth';
import { asyncHandler } from '../utils/error-handler';
import { getPool } from '../data/models/unified-database';

/** days 쿼리 파라미터 정수 파싱 + clamp(1~365). interval 인젝션 방지를 위해 항상 정수 반환. */
function parseDays(raw: unknown, fallback = 7): number {
    const n = parseInt(String(raw ?? ''), 10);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(365, Math.max(1, n));
}

const router = Router();

// 시스템 메트릭은 관리자 전용
router.use(requireAuth, requireAdmin);

// 클러스터 매니저 참조 (서버에서 주입)
let clusterManager: ClusterManager | null = null;

export function setClusterManager(cluster: ClusterManager) {
    clusterManager = cluster;
}

// 활성 WebSocket 연결 수 게터 (서버에서 주입)
let activeConnectionsGetter: () => number = () => 0;

export function setActiveConnectionsGetter(getter: () => number) {
    activeConnectionsGetter = getter;
}

// ================================================
// 시스템 메트릭 (admin-metrics.html용)
// ================================================

/**
 * GET /api/metrics
 * 시스템 메트릭 API (admin-metrics.html에서 사용)
 */
router.get('/', asyncHandler(async (req: Request, res: Response) => {
    const clusterStats = clusterManager?.getStats();
    const nodes = clusterManager?.getNodes() || [];

    // 프로세스 메모리 정보
    const memoryUsage = process.memoryUsage();

    // AgentMonitor에서 에이전트별 메트릭
    const monitor = getAgentMonitor();
    const agentSummary = monitor.getSummary();

    // ApiUsageTracker에서 영구 저장된 통계 가져오기
    const usageTracker = getApiUsageTracker();
    const usageSummary = usageTracker.getSummary();

    // allTime 통계 사용 (api-usage.json에서 가져옴)
    const totalRequests = usageSummary.allTime.totalRequests;
    const totalTokens = usageSummary.allTime.totalTokens;
    const totalErrors = usageSummary.allTime.totalErrors;

    // 평균 응답 시간 계산 (주간 데이터 기반)
    const weeklyData = usageSummary.weekly;
    const avgResponseTime = weeklyData.avgResponseTime || 0;

    res.json(success({
        chat: {
            totalRequests: totalRequests,
            avgResponseTime: avgResponseTime,
            failedRequests: totalErrors,
            successCount: totalRequests - totalErrors,
            totalTokens: totalTokens
        },
        system: {
            uptime: process.uptime(),
            memoryUsage: {
                heapUsed: memoryUsage.heapUsed,
                heapTotal: memoryUsage.heapTotal,
                rss: memoryUsage.rss
            },
            activeConnections: activeConnectionsGetter()
        },
        cluster: {
            totalNodes: clusterStats?.totalNodes || 0,
            onlineNodes: clusterStats?.onlineNodes || 0,
            totalModels: clusterStats?.totalModels || 0,
            nodes: nodes.map(n => ({
                id: n.id,
                name: n.name,
                status: n.status,
                latency: n.latency
            }))
        },
        agents: agentSummary.byAgent,
        usage: {
            today: usageSummary.today,
            weekly: usageSummary.weekly,
            quota: usageSummary.quota
        }
    }));
}));

// ================================================
// 상세 시스템 메트릭
// ================================================

/**
 * GET /api/metrics/metrics
 * 상세 시스템 메트릭 조회
 */
router.get('/metrics', asyncHandler(async (req: Request, res: Response) => {
    const tracker = getApiUsageTracker();
    const summary = tracker.getSummary();
    const cache = getCacheSystem();

    // 시스템 정보
    const uptime = process.uptime();
    const memUsage = process.memoryUsage();

    res.json(success({ system: { uptime: Math.round(uptime), memory: { used: Math.round(memUsage.heapUsed / 1024 / 1024), total: Math.round(memUsage.heapTotal / 1024 / 1024), percentage: Math.round((memUsage.heapUsed / memUsage.heapTotal) * 100) }, cpu: { cores: os.cpus().length, loadAvg: os.loadavg() } }, cluster: clusterManager ? { name: clusterManager.clusterName, stats: clusterManager.getStats(), nodes: clusterManager.getNodes().map(n => ({ id: n.id, name: n.name, status: n.status, latency: n.latency, models: n.models.length })) } : null, ...summary, cache: cache.getStats() }));
}));

// ================================================
// API 사용량
// ================================================

/**
 * GET /api/usage
 * API 사용량 조회
 */
router.get('/usage', asyncHandler(async (req: Request, res: Response) => {
    const tracker = getApiUsageTracker();
    res.json(success(tracker.getSummary()));
}));

/**
 * GET /api/usage/daily
 * 일별 사용량 조회
 */
router.get('/usage/daily', asyncHandler(async (req: Request, res: Response) => {
    const tracker = getApiUsageTracker();
    const days = parseInt(req.query.days as string, 10) || 7;
    res.json(success(tracker.getDailyStats(days)));
}));

// ================================================
// 분석 대시보드
// ================================================

/**
 * GET /api/analytics/daily-conversations?days=N
 * 전체 일별 대화량 (메시지 수 + 세션 수) — conversation_messages 집계 (관리자)
 */
router.get('/analytics/daily-conversations', asyncHandler(async (req: Request, res: Response) => {
    const days = parseDays(req.query.days);
    const r = await getPool().query(
        `SELECT to_char(date_trunc('day', created_at), 'YYYY-MM-DD') AS date,
                COUNT(*) AS messages,
                COUNT(DISTINCT session_id) AS sessions
         FROM conversation_messages
         WHERE created_at >= NOW() - ($1 || ' days')::interval
         GROUP BY 1
         ORDER BY 1`,
        [String(days)]
    );
    const daily = r.rows.map((row: { date: string; messages: string; sessions: string }) => ({
        date: row.date,
        messages: Number(row.messages),
        sessions: Number(row.sessions),
    }));
    res.json(success({ daily }));
}));

/**
 * GET /api/analytics/model-usage?days=N
 * 모델별 assistant 응답 수 집계 (관리자). 백분율은 프론트에서 합계 대비 계산.
 */
router.get('/analytics/model-usage', asyncHandler(async (req: Request, res: Response) => {
    const days = parseDays(req.query.days);
    const r = await getPool().query(
        `SELECT COALESCE(model, '(unknown)') AS model,
                COUNT(*) AS count
         FROM conversation_messages
         WHERE created_at >= NOW() - ($1 || ' days')::interval
           AND role = 'assistant'
         GROUP BY 1
         ORDER BY count DESC`,
        [String(days)]
    );
    const models = r.rows.map((row: { model: string; count: string }) => ({
        model: row.model,
        count: Number(row.count),
    }));
    res.json(success({ models }));
}));

/**
 * GET /api/analytics
 * 종합 분석 대시보드
 */
router.get('/analytics', asyncHandler(async (req: Request, res: Response) => {
    const analytics = getAnalyticsSystem();
    res.json(success(analytics.getDashboard()));
}));

/**
 * GET /api/analytics/agents
 * 에이전트 성능 분석
 */
router.get('/analytics/agents', asyncHandler(async (req: Request, res: Response) => {
    const analytics = getAnalyticsSystem();
    res.json(success(analytics.getAgentPerformance()));
}));

/**
 * GET /api/analytics/behavior
 * 사용자 행동 분석
 */
router.get('/analytics/behavior', asyncHandler(async (req: Request, res: Response) => {
    const analytics = getAnalyticsSystem();
    res.json(success(analytics.getUserBehavior()));
}));

/**
 * GET /api/analytics/cost
 * 비용 분석
 */
router.get('/analytics/cost', asyncHandler(async (req: Request, res: Response) => {
    const analytics = getAnalyticsSystem();
    res.json(success(analytics.getCostAnalysis()));
}));

// ================================================
// 알림
// ================================================

/**
 * GET /api/alerts
 * 알림 히스토리 조회
 */
router.get('/alerts', asyncHandler(async (req: Request, res: Response) => {
    const alerts = getAlertSystem();
    const limit = parseInt(req.query.limit as string, 10) || 50;
    res.json(success({ status: alerts.getStatus(), history: alerts.getAlertHistory(limit) }));
}));

// ================================================
// 캐시
// ================================================

/**
 * GET /api/cache/stats
 * 캐시 통계 조회
 *
 * Phase B Phase 2-A (2026-05-26): classificationCache 항목 제거. LLM classifier
 * 가 삭제되어 분류 캐시도 미운영. queryCache (응답 캐시) 만 노출.
 */
router.get('/cache/stats', asyncHandler(async (req: Request, res: Response) => {
    const cache = getCacheSystem();
    res.json(success({
        queryCache: cache.getStats(),
    }));
}));

/**
 * POST /api/cache/clear
 * 캐시 초기화
 */
router.post('/cache/clear', requireAdmin, asyncHandler(async (req: Request, res: Response) => {
    const cache = getCacheSystem();
    cache.clear();
    res.json(success({ message: '캐시가 초기화되었습니다.' }));
}));

// 연결 풀 엔드포인트 제거됨 (2026-05-19):
//   /api/pool/stats 가 Ollama 시절 connection pool stub 을 노출했으나,
//   vLLM/LiteLLM 마이그레이션 후 OpenAI SDK 가 자체 connection 관리하므로
//   항상 0 stats 만 반환하는 dead 엔드포인트였음.

// ================================================
// 시스템 헬스
// ================================================

/**
 * GET /api/health
 * 시스템 헬스 체크
 */
router.get('/health', asyncHandler(async (req: Request, res: Response) => {
    const analytics = getAnalyticsSystem();
    const health = analytics.getSystemHealth();

    const statusCode = health.status === 'critical' ? 503 :
        health.status === 'degraded' ? 200 : 200;

    res.status(statusCode).json(success(health));
}));

export default router;
export { router as metricsRouter };
