/**
 * ============================================================
 * Audit Routes - 감사 로그 시스템 API 라우트
 * ============================================================
 *
 * 시스템 활동 감사 로그의 조회 및 생성을 담당합니다.
 * 모든 엔드포인트는 관리자(admin) 전용이며,
 * 액션 타입별/사용자별 필터링을 지원합니다.
 *
 * @module routes/audit.routes
 * @description
 * - GET  /api/audit               - 감사 로그 목록 조회 (필터: action, userId, limit)
 * - GET  /api/audit/actions       - 감사 로그 액션 타입 목록
 * - GET  /api/audit/user/:userId  - 특정 사용자 감사 로그 조회
 * - POST /api/audit               - 감사 로그 엔트리 생성
 *
 * @requires requireAuth - JWT 인증 미들웨어
 * @requires requireAdmin - 관리자 권한 미들웨어
 * @requires UnifiedDatabase - 감사 로그 DB 접근
 */

import { Router, Request, Response } from 'express';
import { createLogger } from '../utils/logger';
import { success } from '../utils/api-response';
import { asyncHandler } from '../utils/error-handler';
import { validate } from '../middlewares/validation';
import { createAuditSchema } from '../schemas/audit.schema';
import { requireAuth, requireAdmin } from '../auth';
import { getAuditService } from '../domains/audit';

const logger = createLogger('AuditRoutes');
const router = Router();
const auditService = getAuditService();

// All audit endpoints require admin access
router.use(requireAuth, requireAdmin);

// ================================================
// 감사 로그 조회
// ================================================

/**
 * GET /api/audit
 * 감사 로그 목록 조회 (관리자 전용)
 */
router.get('/', asyncHandler(async (req: Request, res: Response) => {
     const limit = parseInt(req.query.limit as string, 10) || 100;
     const offset = parseInt(req.query.offset as string, 10) || 0;
     const startDate = req.query.startDate as string | undefined;
     const endDate = req.query.endDate as string | undefined;
     const action = req.query.action as string | undefined;
     const userId = req.query.userId as string | undefined;

     const { logs, total } = await auditService.getAuditLogs({
         startDate,
         endDate,
         action,
         userId,
         limit,
         offset,
     });
     res.json(success({ logs, total }));
}));

/**
 * GET /api/audit/actions
 * 감사 로그 액션 타입 목록 (관리자 전용)
 */
router.get('/actions', asyncHandler(async (req: Request, res: Response) => {
     const actions = await auditService.getDistinctActions();

     res.json(success({ actions }));
}));

/**
 * GET /api/audit/user/:userId
 * 특정 사용자 감사 로그 조회 (관리자 전용)
 */
router.get('/user/:userId', asyncHandler(async (req: Request, res: Response) => {
     const { userId } = req.params;
     const limit = parseInt(req.query.limit as string, 10) || 100;
     const { logs, total } = await auditService.getAuditLogs({ userId, limit });
     res.json(success({ logs, total, userId }));
}));

// ================================================
// 감사 로그 생성
// ================================================

/**
 * POST /api/audit
 * 감사 로그 엔트리 생성 (관리자 전용)
 */
router.post('/', validate(createAuditSchema), asyncHandler(async (req: Request, res: Response) => {
     const { action, resourceType, resourceId, details } = req.body;

     await auditService.logAudit({
          action,
          userId: String(req.user!.id),
          resourceType,
         resourceId,
         details,
         ipAddress: req.ip,
         userAgent: req.headers['user-agent']
     });

     res.status(201).json(success({ message: '감사 로그가 생성되었습니다.' }));
}));

export default router;
export { router as auditRouter };
