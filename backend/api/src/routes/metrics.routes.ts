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
import { createLogger } from '../utils/logger';
import { getApiUsageTracker } from '../ollama/api-usage-tracker';
import { getCacheSystem } from '../cache';
import { getAlertSystem } from '../monitoring/alerts';
import { getAnalyticsSystem } from '../monitoring/analytics';
import { getConnectionPool } from '../ollama/connection-pool';
import { ClusterManager } from '../cluster/manager';
import { getAgentMonitor } from '../agents';
import * as os from 'os';
import { success, internalError, serviceUnavailable } from '../utils/api-response';
import { requireAuth, requireAdmin } from '../auth';

const logger = createLogger('MetricsRoutes');
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
router.get('/', (req: Request, res: Response) => {
    try {
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
    } catch (error) {
        logger.error('[Metrics API] 오류:', error);
        res.status(500).json(internalError('메트릭 조회 실패'));
    }
});

// ================================================
// 상세 시스템 메트릭
// ================================================

/**
 * GET /api/metrics/metrics
 * 상세 시스템 메트릭 조회
 */
router.get('/metrics', (req: Request, res: Response) => {
    try {
        const tracker = getApiUsageTracker();
        const summary = tracker.getSummary();
        const cache = getCacheSystem();

        // 시스템 정보
        const uptime = process.uptime();
        const memUsage = process.memoryUsage();

         res.json(success({ system: { uptime: Math.round(uptime), memory: { used: Math.round(memUsage.heapUsed / 1024 / 1024), total: Math.round(memUsage.heapTotal / 1024 / 1024), percentage: Math.round((memUsage.heapUsed / memUsage.heapTotal) * 100) }, cpu: { cores: os.cpus().length, loadAvg: os.loadavg() } }, cluster: clusterManager ? { name: clusterManager.clusterName, stats: clusterManager.getStats(), nodes: clusterManager.getNodes().map(n => ({ id: n.id, name: n.name, status: n.status, latency: n.latency, models: n.models.length })) } : null, ...summary, cache: cache.getStats() }));
     } catch (error) {
         logger.error('메트릭 조회 실패:', error);
         res.status(500).json(internalError('메트릭 조회 실패'));
     }
 });

// ================================================
// API 사용량
// ================================================

/**
 * GET /api/usage
 * API 사용량 조회
 */
router.get('/usage', (req: Request, res: Response) => {
     try {
         const tracker = getApiUsageTracker();
         res.json(success(tracker.getSummary()));
     } catch (error) {
         logger.error('사용량 조회 실패:', error);
         res.status(500).json(internalError('사용량 조회 실패'));
     }
});

/**
 * GET /api/usage/daily
 * 일별 사용량 조회
 */
router.get('/usage/daily', (req: Request, res: Response) => {
     try {
         const tracker = getApiUsageTracker();
         const days = parseInt(req.query.days as string) || 7;
         res.json(success(tracker.getDailyStats(days)));
     } catch (error) {
         logger.error('일별 사용량 조회 실패:', error);
         res.status(500).json(internalError('일별 사용량 조회 실패'));
     }
});

// ================================================
// 분석 대시보드
// ================================================

/**
 * GET /api/analytics
 * 종합 분석 대시보드
 */
router.get('/analytics', (req: Request, res: Response) => {
     try {
         const analytics = getAnalyticsSystem();
         res.json(success(analytics.getDashboard()));
     } catch (error) {
         logger.error('분석 조회 실패:', error);
         res.status(500).json(internalError('분석 조회 실패'));
     }
});

/**
 * GET /api/analytics/agents
 * 에이전트 성능 분석
 */
router.get('/analytics/agents', (req: Request, res: Response) => {
     try {
         const analytics = getAnalyticsSystem();
         res.json(success(analytics.getAgentPerformance()));
     } catch (error) {
         logger.error('에이전트 분석 조회 실패:', error);
         res.status(500).json(internalError('에이전트 분석 조회 실패'));
     }
});

/**
 * GET /api/analytics/behavior
 * 사용자 행동 분석
 */
router.get('/analytics/behavior', (req: Request, res: Response) => {
     try {
         const analytics = getAnalyticsSystem();
         res.json(success(analytics.getUserBehavior()));
     } catch (error) {
         logger.error('행동 분석 조회 실패:', error);
         res.status(500).json(internalError('행동 분석 조회 실패'));
     }
});

/**
 * GET /api/analytics/cost
 * 비용 분석
 */
router.get('/analytics/cost', (req: Request, res: Response) => {
     try {
         const analytics = getAnalyticsSystem();
         res.json(success(analytics.getCostAnalysis()));
     } catch (error) {
         logger.error('비용 분석 조회 실패:', error);
         res.status(500).json(internalError('비용 분석 조회 실패'));
     }
});

// ================================================
// 알림
// ================================================

/**
 * GET /api/alerts
 * 알림 히스토리 조회
 */
router.get('/alerts', (req: Request, res: Response) => {
    try {
        const alerts = getAlertSystem();
        const limit = parseInt(req.query.limit as string) || 50;
         res.json(success({ status: alerts.getStatus(), history: alerts.getAlertHistory(limit) }));
     } catch (error) {
         logger.error('알림 조회 실패:', error);
         res.status(500).json(internalError('알림 조회 실패'));
     }
 });

// ================================================
// 캐시
// ================================================

/**
 * GET /api/cache/stats
 * 캐시 통계 조회
 */
router.get('/cache/stats', (req: Request, res: Response) => {
     try {
         const cache = getCacheSystem();
         res.json(success(cache.getStats()));
     } catch (error) {
         logger.error('캐시 통계 조회 실패:', error);
         res.status(500).json(internalError('캐시 통계 조회 실패'));
     }
});

/**
 * POST /api/cache/clear
 * 캐시 초기화
 */
router.post('/cache/clear', (req: Request, res: Response) => {
    try {
        const cache = getCacheSystem();
        cache.clear();
         res.json(success({ message: '캐시가 초기화되었습니다.' }));
     } catch (error) {
         logger.error('캐시 초기화 실패:', error);
         res.status(500).json(internalError('캐시 초기화 실패'));
     }
 });

// ================================================
// 연결 풀
// ================================================

/**
 * GET /api/pool/stats
 * 연결 풀 통계 조회
 */
router.get('/pool/stats', (req: Request, res: Response) => {
     try {
         const pool = getConnectionPool();
         res.json(success(pool.getStats()));
     } catch (error) {
         logger.error('연결 풀 통계 조회 실패:', error);
         res.status(500).json(internalError('연결 풀 통계 조회 실패'));
     }
});

// ================================================
// 시스템 헬스
// ================================================

/**
 * GET /api/health
 * 시스템 헬스 체크
 */
router.get('/health', (req: Request, res: Response) => {
    try {
        const analytics = getAnalyticsSystem();
        const health = analytics.getSystemHealth();

        const statusCode = health.status === 'critical' ? 503 :
            health.status === 'degraded' ? 200 : 200;

        res.status(statusCode).json(success(health));
    } catch (error) {
        res.status(503).json(serviceUnavailable('Health check failed'));
    }
});

export default router;
export { router as metricsRouter };
