/**
 * ============================================================
 * Agent Monitoring Routes - 에이전트 모니터링 API 라우트
 * ============================================================
 *
 * 에이전트 실행 메트릭 조회, 성능 요약, 메트릭 초기화 등
 * 관리자 전용 모니터링 엔드포인트를 제공합니다.
 *
 * @module routes/agents-monitoring.routes
 * @description
 * - GET  /api/agents-monitoring/metrics  - 전체 에이전트 메트릭 조회 (관리자)
 * - GET  /api/agents-monitoring/summary  - 에이전트 성능 요약 (관리자)
 * - POST /api/agents-monitoring/reset    - 에이전트 메트릭 초기화 (관리자)
 *
 * @requires requireAuth - JWT 인증 미들웨어
 * @requires requireAdmin - 관리자 권한 미들웨어
 * @requires AgentMonitor - 에이전트 모니터링 시스템
 */

import { Router, Request, Response } from 'express';
import { getAgentMonitor } from '../agents';
import { success, notFound, internalError } from '../utils/api-response';
import { requireAuth, requireAdmin } from '../auth';
import { createLogger } from '../utils/logger';

const logger = createLogger('AgentsMonitoringRoutes');

const router = Router();

// 에이전트 모니터링은 관리자 전용
router.use(requireAuth, requireAdmin);

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
          logger.error('[Agent Active] 오류:', error);
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
          logger.error('[Agent Summary] 오류:', error);
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
          logger.error('[Agent Reset] 오류:', error);
          res.status(500).json(internalError('에이전트 메트릭 조회 실패'));
      }
 });

 export default router;
