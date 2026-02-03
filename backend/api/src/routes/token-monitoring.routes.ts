/**
 * 토큰 모니터링 API 라우트
 * LiteLLM 스타일의 API 키/토큰 사용량 모니터링
 */

import { Router, Request, Response } from 'express';
import { getApiKeyManager } from '../ollama/api-key-manager';
import { getApiUsageTracker } from '../ollama/api-usage-tracker';
import { success, internalError } from '../utils/api-response';

const router = Router();

// ================================================
// API 키 모니터링
// ================================================

/**
 * GET /api/monitoring/keys
 * 모든 API 키 상태 조회
 */
router.get('/keys', (req: Request, res: Response) => {
    try {
        const keyManager = getApiKeyManager();
        const usageTracker = getApiUsageTracker();
        const status = keyManager.getStatus();
        const quotaStatus = usageTracker.getQuotaStatus();

        // 각 키의 상세 정보 생성
        const keys = [];
        for (let i = 0; i < status.totalKeys; i++) {
            const keyStatus = status.keyStatuses[i];
            const isActive = i === status.activeKeyIndex;

            keys.push({
                index: i + 1,
                keyId: keyStatus ? `Key ${i + 1}` : 'Unknown',
                isActive,
                failCount: keyStatus?.failCount || 0,
                lastFail: keyStatus?.lastFail,
                status: isActive ? 'active' : (keyStatus?.failCount > 0 ? 'warning' : 'standby')
            });
        }

         res.json(success({ totalKeys: status.totalKeys, activeKeyIndex: status.activeKeyIndex + 1, currentFailures: status.failures, lastFailover: status.lastFailover, keys, quota: quotaStatus }));
     } catch (error: any) {
         console.error('[TokenMonitoring] 키 상태 조회 실패:', error);
         res.status(500).json(internalError(error.message));
     }
 });

/**
 * GET /api/monitoring/usage/daily
 * 일간 사용량 데이터 (차트용)
 */
router.get('/usage/daily', (req: Request, res: Response) => {
    try {
        const usageTracker = getApiUsageTracker();
        const days = parseInt(req.query.days as string) || 7;
        const dailyStats = usageTracker.getDailyStats(days);

        // 차트 데이터 형식으로 변환
        const chartData = {
            labels: dailyStats.map(d => d.date),
            datasets: {
                requests: dailyStats.map(d => d.requests),
                tokens: dailyStats.map(d => d.tokens),
                errors: dailyStats.map(d => d.errors),
                avgResponseTime: dailyStats.map(d => d.avgResponseTime)
            }
        };

         res.json(success(chartData));
     } catch (error: any) {
         console.error('[TokenMonitoring] 일간 통계 조회 실패:', error);
         res.status(500).json(internalError(error.message));
     }
 });

/**
 * GET /api/monitoring/usage/hourly
 * 시간별 사용량 데이터 (오늘)
 */
router.get('/usage/hourly', (req: Request, res: Response) => {
    try {
        const usageTracker = getApiUsageTracker();
        const todayStats = usageTracker.getTodayStats();

        // 시간별 데이터
        const chartData = {
            labels: todayStats.hourlyBreakdown.map(h => `${h.hour}:00`),
            datasets: {
                requests: todayStats.hourlyBreakdown.map(h => h.requests),
                tokens: todayStats.hourlyBreakdown.map(h => h.tokens)
            }
        };

         res.json(success(chartData));
     } catch (error: any) {
         console.error('[TokenMonitoring] 시간별 통계 조회 실패:', error);
         res.status(500).json(internalError(error.message));
     }
 });

/**
 * GET /api/monitoring/quota
 * 할당량 상태 조회
 */
router.get('/quota', (req: Request, res: Response) => {
    try {
        const usageTracker = getApiUsageTracker();
        const quotaStatus = usageTracker.getQuotaStatus();

         res.json(success(quotaStatus));
     } catch (error: any) {
         console.error('[TokenMonitoring] 할당량 조회 실패:', error);
         res.status(500).json(internalError(error.message));
     }
 });

/**
 * GET /api/monitoring/summary
 * 전체 요약 통계
 */
router.get('/summary', (req: Request, res: Response) => {
    try {
        const usageTracker = getApiUsageTracker();
        const keyManager = getApiKeyManager();

        const summary = usageTracker.getSummary();
        const keyStatus = keyManager.getStatus();

         res.json(success({ ...summary, keyInfo: { totalKeys: keyStatus.totalKeys, activeKey: keyStatus.activeKeyIndex + 1, failures: keyStatus.failures } }));
     } catch (error: any) {
         console.error('[TokenMonitoring] 요약 조회 실패:', error);
         res.status(500).json(internalError(error.message));
     }
 });

/**
 * POST /api/monitoring/keys/reset
 * API 키 상태 리셋 (관리자용)
 */
router.post('/keys/reset', (req: Request, res: Response) => {
    try {
        const keyManager = getApiKeyManager();
        keyManager.reset();

         res.json(success({ message: 'API 키 상태가 리셋되었습니다.' }));
     } catch (error: any) {
         console.error('[TokenMonitoring] 키 리셋 실패:', error);
         res.status(500).json(internalError(error.message));
     }
 });

/**
 * GET /api/monitoring/costs
 * 비용 추적 (모델별 예상 비용)
 */
router.get('/costs', (req: Request, res: Response) => {
    try {
        const usageTracker = getApiUsageTracker();
        const todayStats = usageTracker.getTodayStats();
        const weeklyStats = usageTracker.getWeeklyStats();

        // 모델별 가격 (Ollama Cloud 기준 - 예상치)
        const modelPrices: Record<string, { input: number; output: number }> = {
            'gemini-3-flash-preview:cloud': { input: 0.00001, output: 0.00002 },
            'gemini-3-pro-preview:cloud': { input: 0.00005, output: 0.0001 },
            'gpt-oss:120b': { input: 0.0001, output: 0.0002 },
            'default': { input: 0.00001, output: 0.00002 }
        };

        // 모델별 비용 계산
        const modelCosts: Record<string, number> = {};
        let totalCost = 0;

        for (const [model, count] of Object.entries(todayStats.modelUsage)) {
            const prices = modelPrices[model] || modelPrices['default'];
            // 대략적 계산: 요청당 평균 1000 토큰 가정
            const estimatedTokens = count * 1000;
            const cost = estimatedTokens * (prices.input + prices.output) / 2;
            modelCosts[model] = cost;
            totalCost += cost;
        }

         res.json(success({ today: { totalCost: parseFloat(totalCost.toFixed(6)), byModel: modelCosts, totalTokens: todayStats.totalTokens, totalRequests: todayStats.totalRequests }, weekly: { totalTokens: weeklyStats.totalTokens, totalRequests: weeklyStats.totalRequests, estimatedCost: parseFloat((weeklyStats.totalTokens * 0.00001).toFixed(6)) }, priceTable: modelPrices }));
     } catch (error: any) {
         console.error('[TokenMonitoring] 비용 조회 실패:', error);
         res.status(500).json(internalError(error.message));
     }
 });

 export default router;
export { router as tokenMonitoringRouter };
