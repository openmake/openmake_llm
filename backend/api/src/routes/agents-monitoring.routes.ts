/**
 * Agent Monitoring Routes
 * 에이전트 모니터링 및 메트릭 API
 * 
 * @module routes/agents-monitoring
 */

import { Router, Request, Response } from 'express';
import { getAgentMonitor } from '../agents';
import { success, notFound, internalError } from '../utils/api-response';

const router = Router();

/**
 * GET /api/agents/metrics
 * 전체 에이전트 메트릭 조회
 */
router.get('/metrics', (req: Request, res: Response) => {
    try {
        const monitor = getAgentMonitor();
        const metrics = monitor.getAllMetrics();
         res.json(success({ metrics }));
     } catch (error) {
         console.error('[Agent Active] 오류:', error);
         res.status(500).json(internalError('에이전트 메트릭 조회 실패'));
     }
 });

  /**
   * GET /api/agents/summary
  * 에이전트 성능 요약
  */
router.get('/summary', (req: Request, res: Response) => {
    try {
        const monitor = getAgentMonitor();
        const summary = monitor.getSummary();
         res.json(success({ summary }));
     } catch (error) {
         console.error('[Agent Summary] 오류:', error);
         res.status(500).json(internalError('에이전트 메트릭 조회 실패'));
     }
 });

  /**
   * POST /api/agents/reset
  * 에이전트 메트릭 초기화
  */
router.post('/reset', (req: Request, res: Response) => {
    try {
        const monitor = getAgentMonitor();
        monitor.reset();
         res.json(success({ message: '에이전트 메트릭 초기화 완료' }));
     } catch (error) {
         console.error('[Agent Reset] 오류:', error);
         res.status(500).json(internalError('에이전트 메트릭 조회 실패'));
     }
 });

 export default router;
