/**
 * @module controllers/user-memories
 * @description Cross-conversation memory CRUD (claude.ai/ChatGPT Memory 동등).
 *
 * 도입 (2026-05-26): mainstream gap closure Phase 3-A.
 *
 * Endpoints (모두 requireAuth):
 *   GET    /api/users/me/memories       — 본인 active memory 목록
 *   POST   /api/users/me/memories       — 신규 추가 (body: { content })
 *   DELETE /api/users/me/memories/:id   — soft delete
 *   DELETE /api/users/me/memories       — 전체 forget (모두 비활성)
 *
 * 검증:
 *   - content: 1~2000 chars
 *   - 사용자별 최대 N개 (env USER_MEMORY_MAX_COUNT default 50) — POST 시 초과면 400
 *
 * @see data/repositories/user-memory-repository
 */
import { Router, Request } from 'express';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { requireAuth } from '../auth/middleware';
import { validate } from '../middlewares/validation';
import { getPool } from '../data/models/unified-database';
import { UserMemoryRepository } from '../data/repositories/user-memory-repository';
import { createLogger } from '../utils/logger';
import { success, internalError, unauthorized, badRequest, notFound } from '../utils/api-response';

const log = createLogger('UserMemoriesController');

const MAX_COUNT = Number(process.env.USER_MEMORY_MAX_COUNT || '50');
const MAX_CONTENT = Number(process.env.USER_MEMORY_MAX_CONTENT_CHARS || '2000');

const createSchema = z.object({
    content: z.string().min(1).max(MAX_CONTENT),
});

function getUserId(req: Request): string | null {
    if (!req.user) return null;
    if ('userId' in req.user && typeof (req.user as { userId?: unknown }).userId === 'string') {
        return (req.user as { userId: string }).userId;
    }
    if ('id' in req.user) return String(req.user.id);
    return null;
}

export function createUserMemoriesController(): Router {
    const router = Router();

    router.get('/', requireAuth, async (req, res) => {
        const userId = getUserId(req);
        if (!userId) { res.status(401).json(unauthorized()); return; }
        try {
            const repo = new UserMemoryRepository(getPool());
            const memories = await repo.listActiveByUser(userId, MAX_COUNT);
            res.json(success({ memories, maxCount: MAX_COUNT, maxContent: MAX_CONTENT }));
        } catch (err) {
            log.error('list 실패:', err);
            res.status(500).json(internalError('memory 목록 조회 실패'));
        }
    });

    router.post('/', requireAuth, validate(createSchema), async (req, res) => {
        const userId = getUserId(req);
        if (!userId) { res.status(401).json(unauthorized()); return; }
        try {
            const { content } = req.body as z.infer<typeof createSchema>;
            const repo = new UserMemoryRepository(getPool());
            const currentCount = await repo.countActiveByUser(userId);
            if (currentCount >= MAX_COUNT) {
                res.status(400).json(badRequest(`Memory 한도 초과 (최대 ${MAX_COUNT}개). 기존 항목 삭제 후 다시 시도하세요.`));
                return;
            }
            const memory = await repo.create(uuidv4(), userId, content.trim());
            log.info(`memory 생성: userId=${userId} id=${memory.id} len=${memory.content.length}`);
            res.json(success({ memory }));
        } catch (err) {
            log.error('create 실패:', err);
            res.status(500).json(internalError('memory 생성 실패'));
        }
    });

    router.delete('/:id', requireAuth, async (req, res) => {
        const userId = getUserId(req);
        if (!userId) { res.status(401).json(unauthorized()); return; }
        try {
            const repo = new UserMemoryRepository(getPool());
            const deleted = await repo.softDeleteForUser(req.params.id, userId);
            if (!deleted) { res.status(404).json(notFound('memory 없음')); return; }
            res.json(success({ deleted: true }));
        } catch (err) {
            log.error('delete 실패:', err);
            res.status(500).json(internalError('memory 삭제 실패'));
        }
    });

    router.delete('/', requireAuth, async (req, res) => {
        const userId = getUserId(req);
        if (!userId) { res.status(401).json(unauthorized()); return; }
        try {
            const repo = new UserMemoryRepository(getPool());
            const count = await repo.deleteAllForUser(userId);
            log.info(`memory 전체 삭제: userId=${userId} count=${count}`);
            res.json(success({ deleted: count }));
        } catch (err) {
            log.error('deleteAll 실패:', err);
            res.status(500).json(internalError('memory 전체 삭제 실패'));
        }
    });

    return router;
}
