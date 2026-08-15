/**
 * @module controllers/user-extensions
 * @description 확장 번들 (Agent Plugins v1) 설치 레코드 조회/제거 endpoints.
 *
 * 설치는 채팅 도구 `import_extension_from_git` 가 담당 — 이 컨트롤러는
 * 목록/상세/제거만 제공한다. 구성요소 승인은 기존 skill/MCP draft 경로 그대로.
 *
 * Endpoints (모두 requireAuth):
 *   GET    /api/users/me/extensions                     — 본인 active 설치 목록
 *   GET    /api/users/me/extensions/gallery             — 워크스페이스 갤러리 (shared 확장, Phase 3)
 *   POST   /api/users/me/extensions/gallery/:id/install — 갤러리 확장을 본인 계정으로 설치 (ingest 재실행)
 *   GET    /api/users/me/extensions/:id                 — 상세 (구성요소 현재 상태 포함, 본인 소유)
 *   PATCH  /api/users/me/extensions/:id/visibility      — 공유 토글 (소유자 한정, Phase 3)
 *   POST   /api/users/me/extensions/:id/update-check    — 원격 ref 비교 업데이트 확인 (Phase 2)
 *   DELETE /api/users/me/extensions/:id                 — 제거 (구성요소 archive + soft remove, 소유자 한정)
 *
 * ⚠️ 라우트 등록 순서: '/gallery*' 가 '/:id' 보다 먼저여야 한다 (Express 순차 매칭).
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

const visibilitySchema = z.object({
    visibility: z.enum(['private', 'shared']),
});

const galleryInstallSchema = z.object({
    // 공유 확장이 private repo 인 경우 설치자 본인의 token (요청 한정 — DB 미저장)
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

/** ExtensionIngestService 조립 (동적 import — update-check/gallery install 공용). */
async function buildIngestService() {
    const { ExtensionIngestService } = await import('../agents/git-ingest/extension-ingest-service');
    const { GitFetcher } = await import('../agents/git-ingest/git-fetcher');
    const { LLMClient } = await import('../llm/client');
    const { SKILL_CREATOR } = await import('../config/constants');
    return new ExtensionIngestService({
        pool: getPool(),
        llmClientFactory: (model: string) => new LLMClient(model ? { model } : {}),
        fetcherFactory: (opts) => new GitFetcher({ accessToken: opts.accessToken, timeoutMs: SKILL_CREATOR.gitFetchTimeout }),
    });
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

    // ⚠️ '/:id' 보다 먼저 등록 — Express 순차 매칭이라 아래에 두면 id='gallery' 로 잡힘
    router.get('/gallery', requireAuth, async (req, res) => {
        const userId = getUserId(req);
        if (!userId) { res.status(401).json(unauthorized()); return; }
        try {
            const repo = new UserExtensionRepository(getPool());
            const rows = await repo.listShared();
            // 타인 user_id 는 노출하지 않고 owned 플래그만 제공 (user_agents 관용구 동형)
            const extensions = rows.map((r) => ({ ...toPublic(r), owned: r.user_id === userId }));
            res.json(success({ extensions }));
        } catch (err) {
            log.error('gallery 실패:', err);
            res.status(500).json(internalError('갤러리 조회 실패'));
        }
    });

    router.post('/gallery/:id/install', requireAuth, validate(galleryInstallSchema), async (req, res) => {
        const userId = getUserId(req);
        if (!userId) { res.status(401).json(unauthorized()); return; }
        try {
            const repo = new UserExtensionRepository(getPool());
            const shared = await repo.getInstallableById(req.params.id, userId);
            if (!shared) { res.status(404).json(notFound('공유 확장 없음')); return; }

            const body = req.body as z.infer<typeof galleryInstallSchema>;
            const service = await buildIngestService();
            // 설치자 본인 계정으로 동일 소스 ingest 재실행 — 구성요소는 본인 소유 draft 로 생성
            const result = await service.import({
                userId,
                isAdmin: false,
                gitUrl: shared.source_url,
                gitRef: shared.tracking_ref ?? undefined,
                gitPath: shared.source_path,
                accessToken: body.accessToken,
            });
            if ('selectionRequired' in result && result.selectionRequired) {
                // 명시 gitPath 라 도달 불가 — 방어
                res.status(400).json(badRequest('plugin.json 후보가 모호합니다'));
                return;
            }
            log.info(`gallery install: ${req.params.id} → ${result.extensionId} (user=${userId}, updated=${!!result.updated}, upToDate=${!!result.upToDate})`);
            res.json(success({
                extensionId: result.extensionId,
                name: result.name,
                version: result.version,
                updated: result.updated ?? false,
                // deduped = 동일 ref 최근 설치 재사용 — 설치자 관점에선 "이미 최신"과 동일
                upToDate: (result.upToDate ?? false) || result.deduped,
                skills: result.skills,
                mcpServers: result.mcpServers,
                validationWarnings: result.validationWarnings,
            }));
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            log.warn(`gallery install 실패: ${msg}`);
            res.status(400).json(badRequest(`갤러리 설치 실패: ${msg}`));
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

    router.patch('/:id/visibility', requireAuth, validate(visibilitySchema), async (req, res) => {
        const userId = getUserId(req);
        if (!userId) { res.status(401).json(unauthorized()); return; }
        try {
            const body = req.body as z.infer<typeof visibilitySchema>;
            const repo = new UserExtensionRepository(getPool());
            const row = await repo.setVisibility(req.params.id, userId, body.visibility);
            if (!row) { res.status(404).json(notFound('확장 없음')); return; }
            log.info(`확장 visibility 변경: ${row.id} → ${body.visibility} (user=${userId})`);
            res.json(success({ extension: toPublic(row) }));
        } catch (err) {
            log.error('visibility 실패:', err);
            res.status(500).json(internalError('공유 설정 실패'));
        }
    });

    router.post('/:id/update-check', requireAuth, validate(updateCheckSchema), async (req, res) => {
        const userId = getUserId(req);
        if (!userId) { res.status(401).json(unauthorized()); return; }
        try {
            const repo = new UserExtensionRepository(getPool());
            const row = await repo.getByIdForUser(req.params.id, userId, false);
            if (!row || row.status !== 'active') { res.status(404).json(notFound('확장 없음')); return; }

            const service = await buildIngestService();
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
