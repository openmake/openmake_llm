/**
 * ============================================================
 * Admin Conversations Controller
 * ============================================================
 * admin.controller.ts 에서 분리 (파일 크기 가드 — 대화 조회/통계/내보내기 핸들러 책임 분리).
 * 모든 핸들러는 this 상태 비의존 → AdminController.setupRoutes() 가 라우트에 직접 바인딩한다.
 *
 * @module controllers/admin-conversations.controller
 */
import { Request, Response } from 'express';
import { csvCell } from '../utils/csv';
import { getPool } from '../data/models/unified-database';
import { createLogger } from '../utils/logger';
import { success, internalError } from '../utils/api-response';
import { CAPACITY } from '../config/runtime-limits';
import { PAGINATION } from '../config/http-data-limits';

const log = createLogger('AdminController');

/**
 * GET /api/admin/conversations - 전체 대화 목록 (관리자용)
 */
export async function getConversations(req: Request, res: Response): Promise<void> {
    try {
        const pool = getPool();
        const page = Math.max(1, parseInt(req.query.page as string) || 1);
        const limit = Math.min(parseInt(req.query.limit as string) || PAGINATION.USERS_DEFAULT_LIMIT, PAGINATION.USERS_MAX_LIMIT);
        const offset = (page - 1) * limit;
        const startDate = req.query.startDate as string | undefined;
        const endDate = req.query.endDate as string | undefined;
        const date = req.query.date as string | undefined; // Legacy single date support
        const role = req.query.role as string | undefined;
        const search = req.query.search as string | undefined;

        const conditions: string[] = [];
        const params: unknown[] = [];
        let paramIdx = 1;
        // Date range filter (startDate/endDate takes precedence)
        if (startDate) {
            conditions.push(`cm.created_at::date >= $${paramIdx++}`);
            params.push(startDate);
        }
        if (endDate) {
            conditions.push(`cm.created_at::date <= $${paramIdx++}`);
            params.push(endDate);
        }
        // Legacy single date filter (fallback if no range provided)
        if (!startDate && !endDate && date) {
            conditions.push(`cm.created_at::date = $${paramIdx++}`);
            params.push(date);
        }
        if (role && ['user', 'assistant', 'system'].includes(role)) {
            conditions.push(`cm.role = $${paramIdx++}`);
            params.push(role);
        }
        if (search) {
            conditions.push(`cm.content ILIKE $${paramIdx++}`);
            params.push(`%${search}%`);
        }

        const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

        const countResult = await pool.query(
            `SELECT COUNT(*) as total FROM conversation_messages cm ${where}`,
            params
        );
        const total = parseInt(countResult.rows[0].total, 10);

        const dataResult = await pool.query(
            `SELECT
                cm.id,
                cm.session_id,
                cm.role,
                cm.content,
                cm.model,
                cm.created_at,
                cs.title AS session_title,
                u.email AS user_email
             FROM conversation_messages cm
             LEFT JOIN conversation_sessions cs ON cs.id = cm.session_id
             LEFT JOIN users u ON u.id = cs.user_id
             ${where}
             ORDER BY cm.created_at DESC
             LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
            [...params, limit, offset]
        );

        const conversations = dataResult.rows.map((row: Record<string, unknown>) => ({
            id: String(row['id']),
            session_id: row['session_id'] as string,
            role: row['role'] as string,
            content: row['content'] as string,
            model: (row['model'] as string | null) ?? null,
            created_at: row['created_at'] as string,
            session_title: (row['session_title'] as string | null) ?? null,
            user_email: (row['user_email'] as string | null) ?? null
        }));

        res.json(success({ conversations, total, page, limit }));
    } catch (error) {
        log.error('[Admin Conversations] 오류:', error);
        res.status(500).json(internalError('대화 목록 조회 실패'));
    }
}

/**
 * GET /api/admin/stats - 관리자 대시보드 통계
 */
export async function getStats(req: Request, res: Response): Promise<void> {
    try {
        const pool = getPool();
        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);

        const result = await pool.query(
            `SELECT
                (SELECT COUNT(*) FROM conversation_messages
                 WHERE role = 'user' AND created_at >= $1) AS today_queries,
                (SELECT COUNT(*) FROM conversation_messages) AS total_messages,
                (SELECT COUNT(*) FROM conversation_sessions) AS total_sessions`,
            [todayStart.toISOString()]
        );

        res.json(success({
            today_queries: parseInt(result.rows[0].today_queries, 10),
            total_messages: parseInt(result.rows[0].total_messages, 10),
            total_sessions: parseInt(result.rows[0].total_sessions, 10)
        }));
    } catch (error) {
        log.error('[Admin Stats] 오류:', error);
        res.status(500).json(internalError('통계 조회 실패'));
    }
}

/**
 * GET /api/admin/conversations/export - 대화 기록 CSV 내보내기
 */
export async function exportConversations(req: Request, res: Response): Promise<void> {
    try {
        const pool = getPool();
        const format = (req.query.format as string) || 'csv';

        const result = await pool.query(
            `SELECT
                cm.created_at,
                cm.role,
                cm.content,
                cm.model,
                cs.title AS session_title,
                u.email AS user_email
             FROM conversation_messages cm
             LEFT JOIN conversation_sessions cs ON cs.id = cm.session_id
             LEFT JOIN users u ON u.id = cs.user_id
             ORDER BY cm.created_at DESC
             LIMIT $1`,
            [CAPACITY.ADMIN_EXPORT_LIMIT]
        );

        if (format === 'csv') {
            const headers = ['created_at', 'role', 'content', 'model', 'session_title', 'user_email'];
            const csvLines = [
                headers.join(','),
                ...result.rows.map((row: Record<string, unknown>) =>
                    headers.map(h => csvCell(row[h] instanceof Date ? row[h] : (row[h] === null || row[h] === undefined ? '' : String(row[h])))).join(',')
                )
            ];
            res.setHeader('Content-Type', 'text/csv; charset=utf-8');
            res.setHeader('Content-Disposition', 'attachment; filename="conversations.csv"');
            res.send(csvLines.join('\n'));
        } else {
            res.json(success({ conversations: result.rows }));
        }
    } catch (error) {
        log.error('[Admin Export] 오류:', error);
        res.status(500).json(internalError('내보내기 실패'));
    }
}
