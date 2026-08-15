/**
 * @module controllers/user-extensions
 * @description 확장 번들 (Agent Plugins v1) 설치 레코드 조회/제거 endpoints.
 *
 * 설치는 채팅 도구 `import_extension_from_git` 가 담당 — 이 컨트롤러는
 * 목록/상세/제거만 제공한다. 구성요소 승인은 기존 skill/MCP draft 경로 그대로.
 *
 * Endpoints (모두 requireAuth, 본인 소유 한정):
 *   GET    /api/users/me/extensions                   — active 설치 목록
 *   GET    /api/users/me/extensions/:id               — 상세 (구성요소 현재 상태 포함)
 *   POST   /api/users/me/extensions/:id/update-check  — 원격 ref 비교 업데이트 확인 (Phase 2)
 *   DELETE /api/users/me/extensions/:id               — 제거 (구성요소 archive + soft remove)
 *
 * @see data/repositories/user-extension-repository
 */
import { Router, Request } from 'express';
import { z } from 'zod';
import { requireAuth } from '../auth/middleware';
import { validate } from '../middlewares/validation';
import { getPool } from '../data/models/unified-database';
import { UserExtensionRepository, type UserExtensionRow } from '../data/repositories/user-extension-repository';
import { createLogger } from '../utils/logger';
import { success, internalError, unauthorized, notFound, badRequest } from '../utils/api-response';

const updateCheckSchema = z.object({
    // private repo 접근/rate limit 우회용 (요청 한정 — DB 미저장)
    accessToken: z.string().max(200).optional(),
});

const log = createLogger('UserExtensionsController');

function getUserId(req: Request): string | null {
    if (!req.user) return null;
    if ('userId' in req.user && typeof (req.user as { userId?: unknown }).userId === 'string') {
        return (req.user as { userId: string }).userId;
    }
    if ('id' in req.user) return String(req.user.id);
    return null;
}

/** 응답에서 내부 필드(source_hash, user_id) 제외. */
function toPublic(row: UserExtensionRow) {
    const { source_hash: _hash, user_id: _uid, ...rest } = row;
    return rest;
}

export function createUserExtensionsController(): Router {
    const router = Router();

    router.get('/', requireAuth, async (req, res) => {
        const userId = getUserId(req);
        if (!userId) { res.status(401).json(unauthorized()); return; }
        try {
            const repo = new UserExtensionRepository(getPool());
            const rows = await repo.listActiveForUser(userId);
            res.json(success({ extensions: rows.map(toPublic) }));
        } catch (err) {
            log.error('list 실패:', err);
            res.status(500).json(internalError('확장 목록 조회 실패'));
        }
    });

    router.get('/:id', requireAuth, async (req, res) => {
        const userId = getUserId(req);
        if (!userId) { res.status(401).json(unauthorized()); return; }
        try {
            const repo = new UserExtensionRepository(getPool());
            const row = await repo.getByIdForUser(req.params.id, userId, false);
            if (!row) { res.status(404).json(notFound('확장 없음')); return; }
            const components = await repo.listComponents(row.id);
            res.json(success({ extension: toPublic(row), components }));
        } catch (err) {
            log.error('get 실패:', err);
            res.status(500).json(internalError('확장 조회 실패'));
        }
    });

    router.post('/:id/update-check', requireAuth, validate(updateCheckSchema), async (req, res) => {
        const userId = getUserId(req);
        if (!userId) { res.status(401).json(unauthorized()); return; }
        try {
            const repo = new UserExtensionRepository(getPool());
            const row = await repo.getByIdForUser(req.params.id, userId, false);
            if (!row || row.status !== 'active') { res.status(404).json(notFound('확장 없음')); return; }

            const { ExtensionIngestService } = await import('../agents/git-ingest/extension-ingest-service');
            const { GitFetcher } = await import('../agents/git-ingest/git-fetcher');
            const { LLMClient } = await import('../llm/client');
            const { SKILL_CREATOR } = await import('../config/constants');
            const service = new ExtensionIngestService({
                pool: getPool(),
                llmClientFactory: (model: string) => new LLMClient(model ? { model } : {}),
                fetcherFactory: (opts) => new GitFetcher({ accessToken: opts.accessToken, timeoutMs: SKILL_CREATOR.gitFetchTimeout }),
            });
            const body = req.body as z.infer<typeof updateCheckSchema>;
            const result = await service.checkForUpdate({
                sourceUrl: row.source_url,
                sourcePath: row.source_path,
                currentRef: row.source_ref,
                trackingRef: row.tracking_ref,
                accessToken: body.accessToken,
            });
            res.json(success({ ...result, currentVersion: row.version }));
        } catch (err) {
            // 원격 조회 실패(레포 삭제/권한/rate limit)는 사용자 입력 기인 — 400 으로 사유 전달
            const msg = err instanceof Error ? err.message : String(err);
            log.warn(`update-check 실패: ${msg}`);
            res.status(400).json(badRequest(`업데이트 확인 실패: ${msg}`));
        }
    });

    router.delete('/:id', requireAuth, async (req, res) => {
        const userId = getUserId(req);
        if (!userId) { res.status(401).json(unauthorized()); return; }
        try {
            const repo = new UserExtensionRepository(getPool());
            const removed = await repo.remove(req.params.id, userId, false);
            if (!removed) { res.status(404).json(notFound('확장 없음 또는 이미 제거됨')); return; }
            log.info(`확장 제거: userId=${userId} id=${removed.id} name=${removed.name}`);
            res.json(success({ extension: toPublic(removed) }));
        } catch (err) {
            log.error('remove 실패:', err);
            res.status(500).json(internalError('확장 제거 실패'));
        }
    });

    return router;
}
