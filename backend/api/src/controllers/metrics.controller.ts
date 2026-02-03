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

export class MetricsController {
    private router: Router;
    private cluster: ClusterManager;
    private clientsGetter: () => number;

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
     * API 사용량 통계 조회
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
     * 일간 사용량 통계
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
     * 현재 모델 정보 조회
     */
    private getModelInfo(req: Request, res: Response): void {
        try {
            const envConfig = getConfig();
            const model = envConfig.ollamaDefaultModel || 'gemini-3-flash-preview:cloud';

             res.json(success({ model, provider: 'ollama' }));
         } catch (error) {
             log.error('[Model API] 오류:', error);
             res.status(500).json(internalError('모델 정보 조회 실패'));
         }
     }

     getRouter(): Router {
        return this.router;
    }
}

// 팩토리 함수
export function createMetricsController(cluster?: ClusterManager, clientsGetter?: () => number): Router {
    return new MetricsController(cluster, clientsGetter).getRouter();
}
