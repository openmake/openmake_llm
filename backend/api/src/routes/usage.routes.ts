/**
 * ============================================================
 * Usage Routes - API 사용량 통계 라우트
 * ============================================================
 *
 * 인증된 사용자를 대상으로 API 사용량 요약 및 일간 통계를 제공합니다.
 * ApiUsageTracker의 영구 저장된 통계를 기반으로 응답합니다.
 *
 * @module routes/usage.routes
 * @description
 * - GET /api/usage       - API 사용량 통계 요약 (인증)
 * - GET /api/usage/daily - 일간 사용량 조회 (인증, 쿼리: ?days=7)
 *
 * @requires requireAuth - JWT 인증 미들웨어
 * @requires ApiUsageTracker - API 사용량 추적기
 */

import { Router, Request, Response } from 'express';
import { getApiUsageTracker } from '../ollama/api-usage-tracker';
import { success } from '../utils/api-response';
import { requireAuth } from '../auth';
import { asyncHandler } from '../utils/error-handler';

const router = Router();

// API 사용량 조회에 인증 필수
router.use(requireAuth);

/**
 * API 사용량 통계 요약 조회
 * GET /api/usage
 */
router.get('/', asyncHandler(async (req: Request, res: Response) => {
    const tracker = getApiUsageTracker();
    const summary = tracker.getSummary();
    const uptime = Math.round(process.uptime());

    res.json(success({ ...summary, uptime }));
}));

/**
 * API 사용량 일간 통계 조회
 * GET /api/usage/daily?days=7
 */
router.get('/daily', asyncHandler(async (req: Request, res: Response) => {
    const days = parseInt(req.query.days as string) || 7;
    const tracker = getApiUsageTracker();

    res.json(success({ daily: tracker.getDailyStats(days) }));
}));

export default router;
