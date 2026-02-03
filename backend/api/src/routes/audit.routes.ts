/**
 * Audit Log Routes
 * 감사 로그 시스템 API
 */

import { Router, Request, Response } from 'express';
import { createLogger } from '../utils/logger';
import { success, badRequest, internalError } from '../utils/api-response';
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
router.get('/', async (req: Request, res: Response) => {
    try {
        const limit = parseInt(req.query.limit as string) || 100;
        const action = req.query.action as string | undefined;
        const userId = req.query.userId as string | undefined;

        const db = getUnifiedDatabase();
        const allLogs = await db.getAuditLogs(limit);
        let logs = allLogs;

        // Filter by action type if specified
        if (action) {
            logs = logs.filter(log => log.action === action);
        }

        // Filter by userId if specified
        if (userId) {
            logs = logs.filter(log => log.user_id === userId);
        }

        res.json(success({ logs, total: logs.length }));
    } catch (error) {
        logger.error('감사 로그 조회 실패:', error);
        res.status(500).json(internalError('감사 로그 조회 실패'));
    }
});

/**
 * GET /api/audit/actions
 * 감사 로그 액션 타입 목록 (관리자 전용)
 */
router.get('/actions', async (req: Request, res: Response) => {
    try {
        const pool = getPool();
        const result = await pool.query('SELECT DISTINCT action FROM audit_logs ORDER BY action ASC');
        const rows = result.rows as Array<{ action: string }>;
        const actions = rows.map(row => row.action);

        res.json(success({ actions }));
    } catch (error) {
        logger.error('감사 로그 액션 타입 조회 실패:', error);
        res.status(500).json(internalError('감사 로그 액션 타입 조회 실패'));
    }
});

/**
 * GET /api/audit/user/:userId
 * 특정 사용자 감사 로그 조회 (관리자 전용)
 */
router.get('/user/:userId', async (req: Request, res: Response) => {
    try {
        const { userId } = req.params;
        const limit = parseInt(req.query.limit as string) || 100;

        const db = getUnifiedDatabase();
        const allLogs = await db.getAuditLogs(limit);
        const logs = allLogs.filter(log => log.user_id === userId);

        res.json(success({ logs, total: logs.length, userId }));
    } catch (error) {
        logger.error('사용자 감사 로그 조회 실패:', error);
        res.status(500).json(internalError('사용자 감사 로그 조회 실패'));
    }
});

// ================================================
// 감사 로그 생성
// ================================================

/**
 * POST /api/audit
 * 감사 로그 엔트리 생성 (관리자 전용)
 */
router.post('/', async (req: Request, res: Response) => {
    try {
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
    } catch (error) {
        logger.error('감사 로그 생성 실패:', error);
        res.status(500).json(internalError('감사 로그 생성 실패'));
    }
});

export default router;
export { router as auditRouter };
