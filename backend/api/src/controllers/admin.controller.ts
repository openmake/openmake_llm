/**
 * ============================================================
 * Admin Controller
 * ============================================================
 * 관리자 전용 사용자 관리 API
 */

import { Request, Response, Router } from 'express';
import { getUserManager, UserRole } from '../data/user-manager';
import { requireAuth, requireAdmin } from '../auth';
import { createLogger } from '../utils/logger';
import { success, badRequest, notFound, internalError } from '../utils/api-response';

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
        this.router.get('/users/stats', this.getUserStats.bind(this));
        this.router.put('/users/:id', this.updateUser.bind(this));
        this.router.put('/users/:id/role', this.changeUserRole.bind(this));
        this.router.delete('/users/:id', this.deleteUser.bind(this));
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
             res.status(500).json(internalError(String(error)));
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
             res.status(500).json(internalError(String(error)));
         }
    }

    /**
     * PUT /api/admin/users/:id - 사용자 정보 수정
     */
    private async updateUser(req: Request, res: Response): Promise<void> {
        try {
            const userManager = getUserManager();
            const userId = parseInt(req.params.id);
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
             res.status(500).json(internalError(String(error)));
         }
    }

    /**
     * PUT /api/admin/users/:id/role - 사용자 역할 변경
     */
    private async changeUserRole(req: Request, res: Response): Promise<void> {
        try {
            const userManager = getUserManager();
            const userId = parseInt(req.params.id);
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
             res.status(500).json(internalError(String(error)));
         }
    }

    /**
     * DELETE /api/admin/users/:id - 사용자 삭제
     */
    private async deleteUser(req: Request, res: Response): Promise<void> {
        try {
            const userManager = getUserManager();
            const userId = parseInt(req.params.id);

             // 자기 자신 삭제 방지
             if (userId === req.user!.id) {
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
             res.status(500).json(internalError(String(error)));
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
