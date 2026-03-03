/**
 * ============================================================
 * Admin Controller
 * ============================================================
 * 관리자 전용 사용자 관리 API
 */

import { Request, Response, Router } from 'express';
import { getUserManager, UserRole, UserTier } from '../data/user-manager';
import { getPool } from '../data/models/unified-database';
import { requireAuth, requireAdmin } from '../auth';
import { createLogger } from '../utils/logger';
import { success, badRequest, notFound, internalError } from '../utils/api-response';
import { CAPACITY } from '../config/runtime-limits';

const log = createLogger('AdminController');

/**
 * 관리자 전용 사용자 관리 컨트롤러
 * 
 * @class AdminController
 * @description
 * - 사용자 목록 조회 및 검색
 * - 사용자 정보 수정 및 역할 변경
 * - 사용자 삭제
 * - 모든 API는 인증 + 관리자 권한 필수
 */
export class AdminController {
    /** Express 라우터 인스턴스 */
    private router: Router;

    /**
     * AdminController 인스턴스를 생성합니다.
     * 인증 및 관리자 권한 미들웨어를 자동 적용합니다.
     */
    constructor() {
        this.router = Router();
        this.setupRoutes();
    }

    private setupRoutes(): void {
        // 모든 라우트에 인증 및 관리자 권한 필요
        this.router.use(requireAuth);
        this.router.use(requireAdmin);

        this.router.get('/users', this.getUsers.bind(this));
        this.router.post('/users', this.createUser.bind(this));
        this.router.get('/users/stats', this.getUserStats.bind(this));
        this.router.put('/users/:id', this.updateUser.bind(this));
        this.router.put('/users/:id/role', this.changeUserRole.bind(this));
        this.router.put('/users/:id/tier', this.changeUserTier.bind(this));
        this.router.delete('/users/:id', this.deleteUser.bind(this));

        // 관리자용 대화 목록 (모든 사용자 대화 조회)
        this.router.get('/stats', this.getStats.bind(this));
        this.router.get('/conversations/export', this.exportConversations.bind(this));
        this.router.get('/conversations', this.getConversations.bind(this));
    }

    /**
     * GET /api/admin/conversations - 전체 대화 목록 (관리자용)
     */
    private async getConversations(req: Request, res: Response): Promise<void> {
        try {
            const pool = getPool();
            const page = Math.max(1, parseInt(req.query.page as string) || 1);
            const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
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
    private async getStats(req: Request, res: Response): Promise<void> {
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
    private async exportConversations(req: Request, res: Response): Promise<void> {
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
                 LIMIT ${CAPACITY.ADMIN_EXPORT_LIMIT}`
            );

            if (format === 'csv') {
                const headers = ['created_at', 'role', 'content', 'model', 'session_title', 'user_email'];
                const csvLines = [
                    headers.join(','),
                    ...result.rows.map((row: Record<string, unknown>) =>
                        headers.map(h => {
                            const val = String(row[h] ?? '').replace(/"/g, '""');
                            return `"${val}"`;
                        }).join(',')
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


    /**
     * POST /api/admin/users - 새 사용자 생성 (관리자)
     */
    private async createUser(req: Request, res: Response): Promise<void> {
        try {
            const userManager = getUserManager();
            const { username, email, password, role } = req.body as { username?: string; email?: string; password?: string; role?: string };

            if (!email || !email.includes('@')) {
                res.status(400).json(badRequest('유효한 이메일을 입력하세요'));
                return;
            }
            if (!password || password.length < 6) {
                res.status(400).json(badRequest('비밀번호는 6자 이상이어야 합니다'));
                return;
            }
            const validRoles = ['admin', 'user', 'guest'];
            const userRole = validRoles.includes(role ?? '') ? (role as 'admin' | 'user' | 'guest') : 'user';

            const newUser = await userManager.createUser({ username, email, password, role: userRole });
            if (!newUser) {
                res.status(409).json(badRequest('이미 사용 중인 이메일입니다'));
                return;
            }

            log.info(`관리자가 사용자 생성: ${newUser.email} (${userRole})`);
            res.status(201).json(success({ user: newUser }));
        } catch (error) {
            log.error('[Admin Create User] 오류:', error);
            res.status(500).json(internalError('사용자 생성 실패'));
        }
    }

    /**
     * GET /api/admin/users - 사용자 목록
     */
    private async getUsers(req: Request, res: Response): Promise<void> {
        try {
            const userManager = getUserManager();
            const { page, limit, role, search } = req.query;

            const result = await userManager.getAllUsers({
                page: page ? parseInt(page as string) : undefined,
                limit: limit ? parseInt(limit as string) : undefined,
                role: role as UserRole,
                search: search as string
            });

            res.json(success(result));
        } catch (error) {
            log.error('[Admin Users] 오류:', error);
            res.status(500).json(internalError('사용자 목록 조회 실패'));
        }
    }

    /**
     * GET /api/admin/users/stats - 사용자 통계
     */
    private async getUserStats(req: Request, res: Response): Promise<void> {
        try {
            const userManager = getUserManager();
            const stats = await userManager.getStats();
            res.json(success(stats));
        } catch (error) {
            log.error('[Admin Stats] 오류:', error);
            res.status(500).json(internalError('사용자 통계 조회 실패'));
        }
    }

    /**
     * PUT /api/admin/users/:id - 사용자 정보 수정
     */
    private async updateUser(req: Request, res: Response): Promise<void> {
        try {
            const userManager = getUserManager();
            const userId = req.params.id;
            const { email, role, is_active } = req.body;

            const user = await userManager.updateUser(userId, { email, role, is_active });

            if (!user) {
                res.status(404).json(notFound('사용자'));
                return;
            }

            log.info(`사용자 정보 수정: ${user.email}`);
            res.json(success({ user }));
        } catch (error) {
            log.error('[Admin Update User] 오류:', error);
            res.status(500).json(internalError('사용자 정보 수정 실패'));
        }
    }

    /**
     * PUT /api/admin/users/:id/role - 사용자 역할 변경
     */
    private async changeUserRole(req: Request, res: Response): Promise<void> {
        try {
            const userManager = getUserManager();
            const userId = req.params.id;
            const { role } = req.body;

            if (!['admin', 'user', 'guest'].includes(role)) {
                res.status(400).json(badRequest('유효하지 않은 역할입니다'));
                return;
            }

            const user = await userManager.changeRole(userId, role);

            if (!user) {
                res.status(404).json(notFound('사용자'));
                return;
            }

            log.info(`사용자 역할 변경: ${user.email} -> ${role}`);
            res.json(success({ user }));
        } catch (error) {
            log.error('[Admin Change Role] 오류:', error);
            res.status(500).json(internalError('사용자 역할 변경 실패'));
        }
    }

    /**
     * PUT /api/admin/users/:id/tier - 사용자 등급 변경
     */
    private async changeUserTier(req: Request, res: Response): Promise<void> {
        try {
            const userManager = getUserManager();
            const userId = req.params.id;
            const { tier } = req.body;

            const validTiers: UserTier[] = ['free', 'pro', 'enterprise'];
            if (!tier || !validTiers.includes(tier as UserTier)) {
                res.status(400).json(badRequest('유효하지 않은 등급입니다 (free, pro, enterprise)'));
                return;
            }

            const user = await userManager.changeTier(userId, tier as UserTier);

            if (!user) {
                res.status(404).json(notFound('사용자'));
                return;
            }

            log.info(`사용자 등급 변경: ${user.email} -> ${tier}`);
            res.json(success({ user }));
        } catch (error) {
            log.error('[Admin Change Tier] 오류:', error);
            res.status(500).json(internalError('사용자 등급 변경 실패'));
        }
    }

    /**
     * DELETE /api/admin/users/:id - 사용자 삭제
     */
    private async deleteUser(req: Request, res: Response): Promise<void> {
        try {
            const userManager = getUserManager();
            const userId = req.params.id;

            // 자기 자신 삭제 방지 (BUG-R3-006: String()으로 통일하여 타입 불일치 해소)
            const currentUserId = String('userId' in req.user! ? req.user!.userId : req.user!.id);
            if (String(userId) === currentUserId) {
                res.status(400).json(badRequest('자기 자신은 삭제할 수 없습니다'));
                return;
            }

            const deleteSuccess = await userManager.deleteUser(userId);

            if (!deleteSuccess) {
                res.status(400).json(badRequest('삭제할 수 없습니다 (마지막 관리자이거나 존재하지 않음)'));
                return;
            }

            log.info(`사용자 삭제: ID ${userId}`);
            res.json(success({ deleted: true }));
        } catch (error) {
            log.error('[Admin Delete User] 오류:', error);
            res.status(500).json(internalError('사용자 삭제 실패'));
        }
    }

    /**
     * Express 라우터를 반환합니다.
    * @returns 설정된 Router 인스턴스
    */
    getRouter(): Router {
        return this.router;
    }
}

/**
 * AdminController 인스턴스를 생성하는 팩토리 함수
 * 
 * @returns 설정된 Express Router
 */
export function createAdminController(): Router {
    return new AdminController().getRouter();
}
