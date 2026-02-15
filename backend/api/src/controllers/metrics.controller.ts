/**
 * ============================================================
 * Metrics Controller
 * ============================================================
 * 시스템 메트릭, API 사용량 통계 API
 */

import { Request, Response, Router } from 'express';
import { ClusterManager, getClusterManager } from '../cluster/manager';
import { getAgentMonitor } from '../agents';
import { getApiUsageTracker } from '../ollama/api-usage-tracker';
import { getConfig } from '../config';
import { createLogger } from '../utils/logger';
import { success, internalError } from '../utils/api-response';

const log = createLogger('MetricsController');

/**
 * 시스템 메트릭 및 API 사용량 통계 컨트롤러
 *
 * @class MetricsController
 * @description
 * - 시스템 리소스(메모리, uptime) 및 클러스터 상태 메트릭 제공
 * - API 사용량 통계 (일간, 주간, 전체) 조회
 * - 현재 활성 모델 정보 제공
 * - 에이전트별 성능 요약 데이터 포함
 */
export class MetricsController {
    /** Express 라우터 인스턴스 */
    private router: Router;
    /** Ollama 클러스터 매니저 */
    private cluster: ClusterManager;
    /** 활성 WebSocket 클라이언트 수 반환 함수 */
    private clientsGetter: () => number;

    /**
     * MetricsController 인스턴스를 생성합니다.
     *
     * @param cluster - ClusterManager 인스턴스 (선택적, 기본값: 싱글톤)
     * @param clientsGetter - 활성 WebSocket 연결 수 반환 함수 (선택적, 기본값: () => 0)
     */
    constructor(cluster?: ClusterManager, clientsGetter?: () => number) {
        this.router = Router();
        this.cluster = cluster || getClusterManager();
        this.clientsGetter = clientsGetter || (() => 0);
        this.setupRoutes();
    }

    private setupRoutes(): void {
        // 시스템 메트릭
        this.router.get('/', this.getMetrics.bind(this));

        // API 사용량 통계
        this.router.get('/usage', this.getUsage.bind(this));

        // 일간 사용량
        this.router.get('/usage/daily', this.getDailyUsage.bind(this));

        // 현재 모델 정보
        this.router.get('/model', this.getModelInfo.bind(this));
    }

    /**
     * GET /api/system/metrics
     * 시스템 메트릭 조회
     */
    private getMetrics(req: Request, res: Response): void {
        try {
            const clusterStats = this.cluster.getStats();
            const nodes = this.cluster.getNodes();
            const memoryUsage = process.memoryUsage();
            const monitor = getAgentMonitor();
            const agentSummary = monitor.getSummary();
            const usageTracker = getApiUsageTracker();
            const usageSummary = usageTracker.getSummary();

            const totalRequests = usageSummary.allTime.totalRequests;
            const totalTokens = usageSummary.allTime.totalTokens;
            const totalErrors = usageSummary.allTime.totalErrors;
            const avgResponseTime = usageSummary.weekly.avgResponseTime || 0;

             res.json(success({ chat: { totalRequests, avgResponseTime, failedRequests: totalErrors, successCount: totalRequests - totalErrors, totalTokens }, system: { uptime: process.uptime(), memoryUsage: { heapUsed: memoryUsage.heapUsed, heapTotal: memoryUsage.heapTotal, rss: memoryUsage.rss }, activeConnections: this.clientsGetter() }, cluster: { totalNodes: clusterStats.totalNodes, onlineNodes: clusterStats.onlineNodes, totalModels: clusterStats.totalModels, nodes: nodes.map(n => ({ id: n.id, name: n.name, status: n.status, latency: n.latency })) }, agents: agentSummary.byAgent, usage: { today: usageSummary.today, weekly: usageSummary.weekly, quota: usageSummary.quota } }));
         } catch (error) {
             log.error('[Metrics API] 오류:', error);
             res.status(500).json(internalError('메트릭 조회 실패'));
         }
     }

     /**
     * GET /api/system/usage
     * API 사용량 통계 조회 (오늘, 주간, 전체 기간, 쿼터 정보 포함)
     *
     * @param req - Express 요청 객체
     * @param res - Express 응답 객체
     */
    private getUsage(req: Request, res: Response): void {
        try {
            const tracker = getApiUsageTracker();
            const summary = tracker.getSummary();

             res.json(success({ ...summary }));
         } catch (error) {
             log.error('[Usage API] 오류:', error);
             res.status(500).json(internalError('API 사용량 조회 실패'));
         }
     }

     /**
     * GET /api/system/usage/daily
     * 일간 사용량 통계 (기본 7일, days 쿼리로 조절 가능)
     *
     * @param req - Express 요청 객체 (query: days - 조회 기간, 기본값 7)
     * @param res - Express 응답 객체
     */
    private getDailyUsage(req: Request, res: Response): void {
        try {
            const days = parseInt(req.query.days as string) || 7;
            const tracker = getApiUsageTracker();

             res.json(success({ daily: tracker.getDailyStats(days) }));
         } catch (error) {
             log.error('[Usage Daily API] 오류:', error);
             res.status(500).json(internalError('일간 사용량 조회 실패'));
         }
     }

     /**
     * GET /api/system/model
     * 현재 활성 모델 정보 조회 (모델명, ID, 프로바이더)
     *
     * @param req - Express 요청 객체
     * @param res - Express 응답 객체
     */
    private getModelInfo(req: Request, res: Response): void {
        try {
             res.json(success({ model: 'OpenMake LLM Auto', modelId: 'openmake_llm_auto', provider: 'openmake' }));
         } catch (error) {
             log.error('[Model API] 오류:', error);
             res.status(500).json(internalError('모델 정보 조회 실패'));
         }
     }

    /**
     * Express 라우터를 반환합니다.
     * @returns 설정된 Router 인스턴스
     */
     getRouter(): Router {
        return this.router;
    }
}

/**
 * MetricsController 인스턴스를 생성하는 팩토리 함수
 *
 * @param cluster - ClusterManager 인스턴스 (선택적)
 * @param clientsGetter - 활성 연결 수 반환 함수 (선택적)
 * @returns 설정된 Express Router
 */
export function createMetricsController(cluster?: ClusterManager, clientsGetter?: () => number): Router {
    return new MetricsController(cluster, clientsGetter).getRouter();
}
