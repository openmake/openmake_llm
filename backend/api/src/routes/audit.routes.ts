/**
 * Audit Log Routes
 * 감사 로그 시스템 API
 */

import { Router, Request, Response } from 'express';
import { createLogger } from '../utils/logger';
import { success, badRequest, internalError } from '../utils/api-response';
import { asyncHandler } from '../utils/error-handler';
import { requireAuth, requireAdmin } from '../auth';
import { getUnifiedDatabase, getPool } from '../data/models/unified-database';

const logger = createLogger('AuditRoutes');
const router = Router();

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
     const limit = parseInt(req.query.limit as string) || 100;
     const action = req.query.action as string | undefined;
     const userId = req.query.userId as string | undefined;

     const pool = getPool();
     const conditions: string[] = [];
     const params: unknown[] = [];
     let paramIndex = 1;

     if (action) {
         conditions.push(`action = $${paramIndex++}`);
         params.push(action);
     }
     if (userId) {
         conditions.push(`user_id = $${paramIndex++}`);
         params.push(userId);
     }

     const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
     const result = await pool.query(
         `SELECT * FROM audit_logs ${whereClause} ORDER BY created_at DESC LIMIT $${paramIndex}`,
         [...params, limit]
     );

     const logs = result.rows;
     res.json(success({ logs, total: logs.length }));
}));

/**
 * GET /api/audit/actions
 * 감사 로그 액션 타입 목록 (관리자 전용)
 */
router.get('/actions', asyncHandler(async (req: Request, res: Response) => {
     const pool = getPool();
     const result = await pool.query('SELECT DISTINCT action FROM audit_logs ORDER BY action ASC');
     const rows = result.rows as Array<{ action: string }>;
     const actions = rows.map(row => row.action);

     res.json(success({ actions }));
}));

/**
 * GET /api/audit/user/:userId
 * 특정 사용자 감사 로그 조회 (관리자 전용)
 */
router.get('/user/:userId', asyncHandler(async (req: Request, res: Response) => {
     const { userId } = req.params;
     const limit = parseInt(req.query.limit as string) || 100;

     const pool = getPool();
     const result = await pool.query(
         'SELECT * FROM audit_logs WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2',
         [userId, limit]
     );

     const logs = result.rows;
     res.json(success({ logs, total: logs.length, userId }));
}));

// ================================================
// 감사 로그 생성
// ================================================

/**
 * POST /api/audit
 * 감사 로그 엔트리 생성 (관리자 전용)
 */
router.post('/', asyncHandler(async (req: Request, res: Response) => {
     const { action, resourceType, resourceId, details } = req.body;

     if (!action) {
         return res.status(400).json(badRequest('action은 필수입니다.'));
     }

     const db = getUnifiedDatabase();
     await db.logAudit({
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
