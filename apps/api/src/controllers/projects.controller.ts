/**
 * @module controllers/projects
 * @description 사용자별 Project CRUD endpoints.
 *
 * Endpoints (모두 requireAuth):
 *   GET    /api/users/me/projects              — 본인 active project 목록
 *   POST   /api/users/me/projects              — 신규 생성
 *   GET    /api/users/me/projects/:id          — 단일 조회
 *   PUT    /api/users/me/projects/:id          — 갱신
 *   DELETE /api/users/me/projects/:id          — soft delete (is_active=false)
 *
 * 검증:
 *   - name: 1~80 chars
 *   - description: ≤500 chars
 *
 * @see data/repositories/project-repository
 */
import { Router, Request } from 'express';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { requireAuth } from '../auth/middleware';
import { validate } from '../middlewares/validation';
import { getPool } from '../data/models/unified-database';
import { ProjectRepository } from '../data/repositories/project-repository';
import { createLogger } from '../utils/logger';
import { success, internalError, unauthorized, notFound, badRequest } from '../utils/api-response';

const log = createLogger('ProjectsController');

const createSchema = z.object({
    name: z.string().min(1).max(80),
    description: z.string().max(500).nullish(),
});

const updateSchema = z.object({
    name: z.string().min(1).max(80).optional(),
    description: z.string().max(500).nullish(),
});

function getUserId(req: Request): string | null {
    if (!req.user) return null;
    if ('userId' in req.user && typeof (req.user as { userId?: unknown }).userId === 'string') {
        return (req.user as { userId: string }).userId;
    }
    if ('id' in req.user) return String(req.user.id);
    return null;
}

export function createProjectsController(): Router {
    const router = Router();

    router.get('/', requireAuth, async (req, res) => {
        const userId = getUserId(req);
        if (!userId) { res.status(401).json(unauthorized()); return; }
        try {
            const repo = new ProjectRepository(getPool());
            const projects = await repo.listByUser(userId);
            res.json(success({ projects }));
        } catch (err) {
            log.error('list 실패:', err);
            res.status(500).json(internalError('project 목록 조회 실패'));
        }
    });

    router.get('/:id', requireAuth, async (req, res) => {
        const userId = getUserId(req);
        if (!userId) { res.status(401).json(unauthorized()); return; }
        try {
            const repo = new ProjectRepository(getPool());
            const project = await repo.getByIdForUser(req.params.id, userId);
            if (!project) { res.status(404).json(notFound('project 없음')); return; }
            res.json(success({ project }));
        } catch (err) {
            log.error('get 실패:', err);
            res.status(500).json(internalError('project 조회 실패'));
        }
    });

    router.post('/', requireAuth, validate(createSchema), async (req, res) => {
        const userId = getUserId(req);
        if (!userId) { res.status(401).json(unauthorized()); return; }
        try {
            const body = req.body as z.infer<typeof createSchema>;
            const repo = new ProjectRepository(getPool());
            const project = await repo.create({
                id: uuidv4(),
                userId,
                name: body.name,
                description: body.description ?? null,
            });
            log.info(`project 생성: userId=${userId} id=${project.id} name=${project.name}`);
            res.json(success({ project }));
        } catch (err) {
            log.error('create 실패:', err);
            // UNIQUE 위반 — 동일 이름 중복
            if (err instanceof Error && err.message.includes('projects_user_id_name_key')) {
                res.status(400).json(badRequest('동일한 이름의 project 가 이미 있습니다'));
                return;
            }
            res.status(500).json(internalError('project 생성 실패'));
        }
    });

    router.put('/:id', requireAuth, validate(updateSchema), async (req, res) => {
        const userId = getUserId(req);
        if (!userId) { res.status(401).json(unauthorized()); return; }
        try {
            const body = req.body as z.infer<typeof updateSchema>;
            const repo = new ProjectRepository(getPool());
            const project = await repo.update(req.params.id, userId, {
                name: body.name,
                description: body.description === undefined ? undefined : (body.description ?? null),
            });
            if (!project) { res.status(404).json(notFound('project 없음')); return; }
            res.json(success({ project }));
        } catch (err) {
            log.error('update 실패:', err);
            // UNIQUE 위반 — 동일 이름 중복
            if (err instanceof Error && err.message.includes('projects_user_id_name_key')) {
                res.status(400).json(badRequest('동일한 이름의 project 가 이미 있습니다'));
                return;
            }
            res.status(500).json(internalError('project 갱신 실패'));
        }
    });

    router.delete('/:id', requireAuth, async (req, res) => {
        const userId = getUserId(req);
        if (!userId) { res.status(401).json(unauthorized()); return; }
        try {
            const repo = new ProjectRepository(getPool());
            const deleted = await repo.softDelete(req.params.id, userId);
            if (!deleted) { res.status(404).json(notFound('project 없음')); return; }
            res.json(success({ deleted: true }));
        } catch (err) {
            log.error('delete 실패:', err);
            res.status(500).json(internalError('project 삭제 실패'));
        }
    });

    return router;
}
