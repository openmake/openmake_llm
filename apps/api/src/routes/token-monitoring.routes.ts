/**
 * ============================================================
 * Token Monitoring Routes - 토큰 사용량 모니터링 API 라우트
 * ============================================================
 *
 * LiteLLM 스타일의 API 키 상태 모니터링, 일간/시간별 사용량 추적,
 * 할당량 관리, 비용 추정 등 토큰 운영 전반을 제공합니다.
 * 모든 엔드포인트는 관리자(admin) 전용입니다.
 *
 * @module routes/token-monitoring.routes
 * @description
 * - GET  /api/monitoring/keys        - 모든 API 키 상태 조회
 * - GET  /api/monitoring/usage/daily  - 일간 사용량 (차트 데이터)
 * - GET  /api/monitoring/usage/hourly - 시간별 사용량 (오늘)
 * - GET  /api/monitoring/quota        - 할당량 상태 조회
 * - GET  /api/monitoring/summary      - 전체 요약 통계
 * - POST /api/monitoring/keys/reset   - API 키 상태 리셋
 * - GET  /api/monitoring/costs        - 모델별 비용 추적
 *
 * @requires requireAuth - JWT 인증 미들웨어
 * @requires requireAdmin - 관리자 권한 미들웨어
 * @requires ApiKeyManager - API 키 매니저
 * @requires ApiUsageTracker - 사용량 추적기
 */

import { Router, Request, Response } from 'express';
import { getApiUsageTracker } from '../llm';
import { success } from '../utils/api-response';
import { requireAuth, requireAdmin } from '../auth';
import { asyncHandler } from '../utils/error-handler';
import { MODEL_PRICING, TOKEN_COST } from '../config/pricing';


const router = Router();

// 토큰 모니터링은 관리자 전용
router.use(requireAuth, requireAdmin);

// API 키 모니터링 엔드포인트(GET /api/monitoring/keys) 제거됨 — 단일 master key 운영.
// 할당량(quota) 조회는 GET /api/monitoring/quota 가 담당.

/**
 * GET /api/monitoring/usage/daily
 * 일간 사용량 데이터 (차트용)
 */
router.get('/usage/daily', asyncHandler(async (req: Request, res: Response) => {
    const usageTracker = getApiUsageTracker();
    const days = parseInt(req.query.days as string, 10) || 7;
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
}));

/**
 * GET /api/monitoring/usage/hourly
 * 시간별 사용량 데이터 (오늘)
 */
router.get('/usage/hourly', asyncHandler(async (req: Request, res: Response) => {
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
}));

/**
 * GET /api/monitoring/quota
 * 할당량 상태 조회
 */
router.get('/quota', asyncHandler(async (req: Request, res: Response) => {
    const usageTracker = getApiUsageTracker();
    const quotaStatus = usageTracker.getQuotaStatus();
    res.json(success(quotaStatus));
}));

/**
 * GET /api/monitoring/summary
 * 전체 요약 통계 (사용량 추적기 단독)
 */
router.get('/summary', asyncHandler(async (req: Request, res: Response) => {
    const usageTracker = getApiUsageTracker();
    res.json(success(usageTracker.getSummary()));
}));

// POST /api/monitoring/keys/reset 제거됨 — 단일 master key 운영이라 불필요.

/**
 * GET /api/monitoring/costs
 * 비용 추적 (모델별 예상 비용)
 */
router.get('/costs', asyncHandler(async (req: Request, res: Response) => {
    const usageTracker = getApiUsageTracker();
    const todayStats = usageTracker.getTodayStats();
    const weeklyStats = usageTracker.getWeeklyStats();

    // 모델별 가격 (예상치)
    const modelPrices = MODEL_PRICING;

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

    res.json(success({ today: { totalCost: parseFloat(totalCost.toFixed(6)), byModel: modelCosts, totalTokens: todayStats.totalTokens, totalRequests: todayStats.totalRequests }, weekly: { totalTokens: weeklyStats.totalTokens, totalRequests: weeklyStats.totalRequests, estimatedCost: parseFloat((weeklyStats.totalTokens * TOKEN_COST.WEEKLY_ESTIMATE_COST_PER_TOKEN).toFixed(6)) }, priceTable: modelPrices }));
}));

export default router;
export { router as tokenMonitoringRouter };
