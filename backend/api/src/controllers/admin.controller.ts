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

        // GDPR Phase D — 14세 미만 셀프 동의 admin endpoint
        this.router.get('/guardian-consent-pending', this.listGuardianPending.bind(this));
        this.router.post('/users/:id/guardian-verify', this.verifyGuardianConsent.bind(this));

        // GDPR Phase D follow-up — alert_history 조회 (admin dashboard 용)
        this.router.get('/alerts/history', this.listAlertHistory.bind(this));
        // alert_history acknowledge (확인 처리) — 운영자 ID/시간 기록
        this.router.post('/alerts/:id/acknowledge', this.acknowledgeAlert.bind(this));

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
                 LIMIT $1`,
                [CAPACITY.ADMIN_EXPORT_LIMIT]
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
            // user.role_changed audit (critical, AlertSystem 자동) — admin 권한 변화 가시성
            void (async () => {
                try {
                    const adminId = String('userId' in req.user! ? req.user!.userId : req.user!.id);
                    const { getAuditService } = await import('../services/AuditService');
                    await getAuditService().logAudit({
                        action: 'user.role_changed',
                        userId: adminId,
                        resourceType: 'user',
                        resourceId: userId,
                        details: { newRole: role, targetEmail: user.email },
                        ipAddress: req.ip,
                        userAgent: req.headers['user-agent'],
                        actor: {
                            email: 'email' in req.user! ? (req.user as { email?: string }).email : undefined,
                            role: 'role' in req.user! ? (req.user as { role?: string }).role : undefined,
                        },
                    });
                } catch (e) { log.warn('[audit] user.role_changed 기록 실패:', e); }
            })();
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
            // GDPR Article 17 — user.deleted audit (critical, AlertSystem 자동)
            void (async () => {
                try {
                    const { getAuditService } = await import('../services/AuditService');
                    await getAuditService().logAudit({
                        action: 'user.deleted',
                        userId: currentUserId,  // admin actor
                        resourceType: 'user',
                        resourceId: userId,
                        ipAddress: req.ip,
                        userAgent: req.headers['user-agent'],
                        actor: {
                            email: 'email' in req.user! ? (req.user as { email?: string }).email : undefined,
                            role: 'role' in req.user! ? (req.user as { role?: string }).role : undefined,
                        },
                    });
                } catch (e) { log.warn('[audit] user.deleted 기록 실패:', e); }
            })();
            res.json(success({ deleted: true }));
        } catch (error) {
            log.error('[Admin Delete User] 오류:', error);
            res.status(500).json(internalError('사용자 삭제 실패'));
        }
    }

    /**
     * GET /api/admin/guardian-consent-pending — 14세 미만 가입 대기 list (GDPR Phase D)
     */
    private async listGuardianPending(_req: Request, res: Response): Promise<void> {
        try {
            const { getPool } = await import('../data/models/unified-database');
            const r = await getPool().query(
                `SELECT g.id, g.user_id, g.guardian_email, g.status, g.created_at,
                        u.username, u.email AS user_email, u.birth_date
                 FROM guardian_consent_pending g
                 JOIN users u ON u.id = g.user_id
                 WHERE g.status = 'pending'
                 ORDER BY g.created_at ASC
                 LIMIT 200`,
            );
            res.json(success({ pending: r.rows }));
        } catch (error) {
            log.error('[Admin Guardian List] 오류:', error);
            res.status(500).json(internalError('보류 list 조회 실패'));
        }
    }

    /**
     * POST /api/admin/users/:id/guardian-verify — 14세 미만 동의 verify (GDPR Phase D)
     * body: { decision: 'verified' | 'rejected', reason?: string }
     */
    private async verifyGuardianConsent(req: Request, res: Response): Promise<void> {
        try {
            const userId = req.params.id;
            const { decision, reason } = req.body as { decision?: string; reason?: string };
            if (decision !== 'verified' && decision !== 'rejected') {
                res.status(400).json(badRequest('decision 은 verified 또는 rejected 여야 합니다'));
                return;
            }
            const adminId = String('userId' in req.user! ? req.user!.userId : req.user!.id);
            const { getPool } = await import('../data/models/unified-database');
            const pool = getPool();

            const upd = await pool.query(
                `UPDATE guardian_consent_pending
                 SET status = $2, reason = $3, verified_at = NOW(), verified_by_admin_id = $4
                 WHERE user_id = $1 AND status = 'pending'
                 RETURNING id`,
                [userId, decision, reason || null, adminId],
            );
            if (upd.rowCount === 0) {
                res.status(404).json(badRequest('보류 row 없음 또는 이미 처리됨'));
                return;
            }

            await pool.query(
                `UPDATE users
                 SET minor_status = $2, is_active = $3
                 WHERE id = $1`,
                [userId, decision === 'verified' ? 'minor_verified' : 'minor_rejected', decision === 'verified'],
            );

            log.info(`[GDPR-D] guardian verify user=${userId} decision=${decision} admin=${adminId}`);
            res.json(success({ user_id: userId, decision }));
        } catch (error) {
            log.error('[Admin Guardian Verify] 오류:', error);
            res.status(500).json(internalError('동의 verify 실패'));
        }
    }

    /**
     * GET /api/admin/alerts/history — alert_history DB 조회 + pagination + filter.
     * 쿼리: limit, offset, type, severity, startDate, endDate.
     */
    private async listAlertHistory(req: Request, res: Response): Promise<void> {
        try {
            const limit = Math.min(parseInt(String(req.query.limit ?? '50'), 10) || 50, 500);
            const offset = parseInt(String(req.query.offset ?? '0'), 10) || 0;
            const type = req.query.type ? String(req.query.type) : null;
            const severity = req.query.severity ? String(req.query.severity) : null;
            const startDate = req.query.startDate ? String(req.query.startDate) : null;
            const endDate = req.query.endDate ? String(req.query.endDate) : null;
            // acknowledged 필터: 'true'/'false' string, 미설정 시 전체
            const ackParam = req.query.acknowledged !== undefined ? String(req.query.acknowledged) : null;

            const conditions: string[] = [];
            const params: unknown[] = [];
            let idx = 1;
            if (type) { conditions.push(`type = $${idx++}`); params.push(type); }
            if (severity) { conditions.push(`severity = $${idx++}`); params.push(severity); }
            if (startDate) { conditions.push(`created_at >= $${idx++}`); params.push(startDate); }
            if (endDate) { conditions.push(`created_at <= $${idx++}`); params.push(endDate); }
            if (ackParam === 'true') { conditions.push(`acknowledged = TRUE`); }
            else if (ackParam === 'false') { conditions.push(`acknowledged = FALSE`); }
            const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

            const { getPool } = await import('../data/models/unified-database');
            const pool = getPool();

            const totalRes = await pool.query<{ count: string }>(
                `SELECT COUNT(*)::text AS count FROM alert_history ${whereClause}`, params,
            );
            const total = parseInt(totalRes.rows[0]?.count ?? '0', 10);

            const dataRes = await pool.query(
                `SELECT id, type, severity, title, message, data, created_at,
                        acknowledged, acknowledged_by, acknowledged_at
                 FROM alert_history ${whereClause}
                 ORDER BY created_at DESC
                 LIMIT $${idx++} OFFSET $${idx++}`,
                [...params, limit, offset],
            );
            res.json(success({ history: dataRes.rows, total, limit, offset }));
        } catch (error) {
            log.error('[Admin AlertHistory] 오류:', error);
            res.status(500).json(internalError('알림 이력 조회 실패'));
        }
    }

    /**
     * POST /api/admin/alerts/:id/acknowledge — alert_history 행 ack 처리.
     * 이미 ack 된 row 는 idempotent (no-op, 기존 ack 정보 그대로 반환).
     * 운영자 ID + 시간 기록으로 알림 처리 추적.
     */
    private async acknowledgeAlert(req: Request, res: Response): Promise<void> {
        try {
            const id = parseInt(req.params.id, 10);
            if (!Number.isFinite(id) || id <= 0) {
                res.status(400).json(badRequest('잘못된 alert id'));
                return;
            }
            const userId = req.user && 'id' in req.user ? String((req.user as { id?: string | number }).id) : null;
            if (!userId) {
                res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: '인증 필요' } });
                return;
            }

            const { getPool } = await import('../data/models/unified-database');
            const pool = getPool();
            // acknowledged=FALSE 인 row 만 UPDATE — 중복 ack 시 정보 덮어쓰기 방지
            const r = await pool.query(
                `UPDATE alert_history
                 SET acknowledged = TRUE, acknowledged_by = $1, acknowledged_at = NOW()
                 WHERE id = $2 AND acknowledged = FALSE
                 RETURNING id, type, severity, title, acknowledged, acknowledged_by, acknowledged_at`,
                [userId, id],
            );
            if (r.rowCount === 0) {
                // 이미 ack 됐거나 id 없음 — 현재 상태 조회 후 반환 (idempotent)
                const cur = await pool.query(
                    `SELECT id, type, severity, title, acknowledged, acknowledged_by, acknowledged_at
                     FROM alert_history WHERE id = $1`,
                    [id],
                );
                if (cur.rowCount === 0) {
                    res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'alert 없음' } });
                    return;
                }
                res.json(success({ alert: cur.rows[0], alreadyAcknowledged: true }));
                return;
            }

            // audit_logs INSERT — fire-and-forget (CRITICAL_ACTIONS whitelist 외라 alert 자체는 안 보냄)
            void (async () => {
                try {
                    const { getAuditService } = await import('../services/AuditService');
                    await getAuditService().logAudit({
                        action: 'alert.acknowledged',
                        userId,
                        resourceType: 'alert',
                        resourceId: String(id),
                        details: { type: r.rows[0].type, severity: r.rows[0].severity },
                        ipAddress: req.ip,
                        userAgent: req.headers['user-agent'],
                        actor: {
                            email: req.user && 'email' in req.user ? (req.user as { email?: string }).email : undefined,
                            role: req.user && 'role' in req.user ? (req.user as { role?: string }).role : undefined,
                        },
                    });
                } catch (e) { log.warn('[audit] alert.acknowledged 기록 실패:', e); }
            })();

            res.json(success({ alert: r.rows[0], alreadyAcknowledged: false }));
        } catch (error) {
            log.error('[Admin AlertAck] 오류:', error);
            res.status(500).json(internalError('알림 확인 처리 실패'));
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
