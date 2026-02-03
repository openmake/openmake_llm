/**
 * Usage Routes
 * API 사용량 통계 라우트 모듈
 * 
 * @module routes/usage
 */

import { Router, Request, Response } from 'express';
import { getApiUsageTracker } from '../ollama/api-usage-tracker';
import { success, internalError } from '../utils/api-response';

const router = Router();

/**
 * API 사용량 통계 요약 조회
 * GET /api/usage
 */
router.get('/', (req: Request, res: Response) => {
    try {
         const tracker = getApiUsageTracker();
         const summary = tracker.getSummary();
         const uptime = Math.round(process.uptime());

         res.json(success({ ...summary, uptime }));
     } catch (error) {
          console.error('[Usage API] 오류:', error);
          res.status(500).json(internalError('API 사용량 조회 실패'));
      }
});

/**
 * API 사용량 일간 통계 조회
 * GET /api/usage/daily?days=7
 */
router.get('/daily', (req: Request, res: Response) => {
    try {
        const days = parseInt(req.query.days as string) || 7;
        const tracker = getApiUsageTracker();

         res.json(success({ daily: tracker.getDailyStats(days) }));
     } catch (error) {
         console.error('[Usage Daily API] 오류:', error);
         res.status(500).json(internalError('일간 사용량 조회 실패'));
     }
});

export default router;
