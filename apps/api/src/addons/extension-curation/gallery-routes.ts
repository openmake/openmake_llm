/**
 * 확장 갤러리·공유 토글 (큐레이션 add-on, §8-2 — 종전 Base `controllers/user-extensions.controller` 에서 경로·응답 그대로 이전)
 *
 *   GET   /api/users/me/extensions/gallery              — 워크스페이스 갤러리 (shared 확장 + admin 큐레이션 카탈로그)
 *   POST  /api/users/me/extensions/gallery/:id/install  — 갤러리 확장을 본인 계정으로 설치 (ingest 재실행)
 *   PATCH /api/users/me/extensions/:id/visibility       — 공유 토글 (소유자 한정)
 *
 * 앱은 add-on 라우트를 Base 확장 라우터보다 먼저 마운트하고 add-on 게이트(꺼짐 404 · 조직 allowlist 밖 403)를 지난다.
 * 저장소·설치 엔진·원본 정책은 Base 포트(`runtime-ports/extension-sharing`)로 쓴다.
 *
 * @module addons/extension-curation/gallery-routes
 */
import { Router } from 'express';
import { z } from 'zod';
import { isAdminRole, requireAuth, validate } from '../../runtime-ports/request-auth';
import {
    activeOrgFor, catalogSourceStore, ExtensionSourceBlockedError, galleryDeploymentModes, installSharedExtension,
    memberOrgIds, requestUserId, toPublicExtension, userExtensionStore,
} from '../../runtime-ports/extension-sharing';
import { extensionInstallPreviewEnabled } from '../../config/extension-install-preview';
import { extensionGalleryGroupSourcesEnabled } from '../../config/extension-naming';
import { createLogger } from '../../utils/logger';
import { success, internalError, unauthorized, notFound, badRequest } from '../../utils/api-response';

const log = createLogger('UserExtensionsController');

const visibilitySchema = z.object({
    visibility: z.enum(['private', 'shared', 'organization']),
});

const galleryInstallSchema = z.object({
    // 공유 확장이 private repo 인 경우 설치자 본인의 token (요청 한정 — DB 미저장)
    accessToken: z.string().max(200).optional(),
});

/** 원본 정책 거절(403 EXTENSION_SOURCE_BLOCKED)은 400 변환을 타지 않고 전역 errorHandler 로 넘긴다 */
function rethrowPolicyError(err: unknown): void {
    if (err instanceof ExtensionSourceBlockedError) throw err;
}

export function createGalleryRouter(): Router {
    const router = Router();

    router.get('/', requireAuth, async (req, res) => {
        const userId = requestUserId(req);
        if (!userId) { res.status(401).json(unauthorized()); return; }
        try {
            const rows = await userExtensionStore().listShared(undefined, await memberOrgIds(userId));
            // 타인 user_id 는 노출하지 않고 owned 플래그만 제공 (user_agents 관용구 동형)
            const modes = await galleryDeploymentModes(userId);
            const extensions = rows.map((r) => {
                const item = { ...toPublicExtension(r), owned: r.user_id === userId };
                // 조직 배포 모드(§8-1, opt-in) — 활성 조직 공개 항목에만 이 멤버의 적용 모드. 꺼져 있으면 필드 없음(종전)
                const mode = modes?.get(r.id);
                return mode ? { ...item, deployment_mode: mode } : item;
            });
            // admin 큐레이션 카탈로그 (enabled 소스만) — 실패해도 갤러리 자체는 응답 (fail-open)
            let catalog: Array<Record<string, unknown>> = [];
            try {
                catalog = (await catalogSourceStore().listEnabled()).map((c) => ({
                    id: c.id, url: c.url, name: c.name, description: c.description,
                    plugins: c.plugins, last_synced_at: c.last_synced_at,
                }));
            } catch (err) {
                log.warn('catalog 조회 실패 (갤러리는 계속):', err);
            }
            // 설치 미리보기(M1b) — 켜져 있을 때만 필드를 싣는다(꺼져 있으면 응답 모양이 종전과 같다)
            // 다중 플러그인 원본 묶음(opt-in, 2026-11-28) — 켜져 있을 때만 필드를 싣는다(웹이 원본별 카드로 묶는다)
            res.json(success({
                extensions, catalog,
                ...(extensionInstallPreviewEnabled() ? { installPreview: true } : {}),
                ...(extensionGalleryGroupSourcesEnabled() ? { groupSources: true } : {}),
            }));
        } catch (err) {
            log.error('gallery 실패:', err);
            res.status(500).json(internalError('갤러리 조회 실패'));
        }
    });

    router.post('/:id/install', requireAuth, validate(galleryInstallSchema), async (req, res) => {
        const userId = requestUserId(req);
        if (!userId) { res.status(401).json(unauthorized()); return; }
        try {
            const shared = await userExtensionStore().getInstallableById(req.params.id, userId, await memberOrgIds(userId));
            if (!shared) { res.status(404).json(notFound('공유 확장 없음')); return; }

            const body = req.body as z.infer<typeof galleryInstallSchema>;
            // 설치자 본인 계정으로 동일 소스 ingest 재실행 — 구성요소는 본인 소유 draft 로 생성 (조직 배포 조정과 같은 입력)
            const result = await installSharedExtension(shared, userId, { isAdmin: isAdminRole(req.user?.role), accessToken: body.accessToken });
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
                agents: result.agents,
                validationWarnings: result.validationWarnings,
            }));
        } catch (err) {
            rethrowPolicyError(err);
            const msg = err instanceof Error ? err.message : String(err);
            log.warn(`gallery install 실패: ${msg}`);
            res.status(400).json(badRequest(`갤러리 설치 실패: ${msg}`));
        }
    });

    return router;
}

/** mountPath `/api/users/me/extensions/:id/visibility` — `:id` 를 받으려고 mergeParams */
export function createVisibilityRouter(): Router {
    const router = Router({ mergeParams: true });

    router.patch('/', requireAuth, validate(visibilitySchema), async (req, res) => {
        const userId = requestUserId(req);
        if (!userId) { res.status(401).json(unauthorized()); return; }
        const id = String((req.params as Record<string, string>).id ?? '');
        try {
            const body = req.body as z.infer<typeof visibilitySchema>;
            // organization 공개는 요청자의 활성 조직(멤버십 검증 완료)에만 — 임의 org_id 를 받지 않는다 (user_agents 와 같은 규칙)
            const activeOrg = body.visibility === 'organization' ? await activeOrgFor(userId) : null;
            if (body.visibility === 'organization' && !activeOrg) {
                res.status(400).json(badRequest('활성 조직이 없습니다. 먼저 조직을 선택하세요.'));
                return;
            }
            const row = await userExtensionStore().setVisibility(id, userId, body.visibility, activeOrg?.orgId ?? null);
            if (!row) { res.status(404).json(notFound('확장 없음')); return; }
            log.info(`확장 visibility 변경: ${row.id} → ${body.visibility} (user=${userId})`);
            res.json(success({ extension: toPublicExtension(row) }));
        } catch (err) {
            log.error('visibility 실패:', err);
            res.status(500).json(internalError('공유 설정 실패'));
        }
    });

    return router;
}
