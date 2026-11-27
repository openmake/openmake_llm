/**
 * @module controllers/user-extensions
 * @description 확장 번들 (Agent Plugins v1) 설치 레코드 조회/제거 endpoints.
 *
 * 설치는 채팅 도구 `import_extension_from_git` 가 담당 — 이 컨트롤러는
 * 목록/상세/제거만 제공한다. 구성요소 승인은 기존 skill/MCP draft 경로 그대로.
 *
 * Endpoints (모두 requireAuth):
 *   GET    /api/users/me/extensions                     — 본인 active 설치 목록
 *   GET    /api/users/me/extensions/gallery             — 워크스페이스 갤러리 (shared 확장 + admin 큐레이션 카탈로그)
 *   POST   /api/users/me/extensions/gallery/:id/install — 갤러리 확장을 본인 계정으로 설치 (ingest 재실행)
 *   POST   /api/users/me/extensions/catalog/:id/preview — 설치 미리보기(M1b, EXTENSION_INSTALL_PREVIEW_ENABLED — 쓰기·LLM 없음)
 *   POST   /api/users/me/extensions/catalog/:id/install — 카탈로그 소스의 플러그인을 본인 계정으로 설치
 *   GET    /api/users/me/extensions/:id                 — 상세 (구성요소 현재 상태 포함, 본인 소유)
 *   PATCH  /api/users/me/extensions/:id/visibility      — 공유 토글 (소유자 한정, Phase 3)
 *   POST   /api/users/me/extensions/:id/update-check    — 원격 ref 비교 업데이트 확인 (Phase 2)
 *   DELETE /api/users/me/extensions/:id                 — 제거 (구성요소 archive + soft remove, 소유자 한정)
 *
 * Admin (requireAdmin — 큐레이션 카탈로그 관리):
 *   GET    /api/users/me/extensions/catalog/admin       — 전체 소스 목록 (disabled 포함)
 *   POST   /api/users/me/extensions/catalog             — 소스 등록 + 스냅샷 동기화
 *   POST   /api/users/me/extensions/catalog/:id/sync    — 스냅샷 재동기화 (응답에 sync_status·last_sync_error, M4)
 *   PUT    /api/users/me/extensions/catalog/:id/credential — 원본 접근 토큰 저장·삭제 (write-only, 암호화 — M4)
 *   PATCH  /api/users/me/extensions/catalog/:id         — 하위 경로(source_subpath)·이름 설치 별칭(alias)·정적 색인 주소(index_url) 지정 (M4·M5·M6)
 *   POST   /api/users/me/extensions/install-by-name    — `플러그인@마켓플레이스` 이름 설치 (M5, user-extensions-named.routes)
 *   POST   /api/users/me/extensions/preview-by-name    — 이름 설치 미리보기 (M1b 연장, EXTENSION_INSTALL_PREVIEW_ENABLED)
 *   DELETE /api/users/me/extensions/catalog/:id         — 소스 삭제
 *   GET|POST /api/users/me/extensions/org-owned · POST …/org-owned/:id/update · DELETE …/org-owned/:id
 *                                                      — 조직 소유 설치(P8, EXTENSION_ORG_OWNED_INSTALL_ENABLED — OFF 면 종전 라우트로)
 *
 * ⚠️ 라우트 등록 순서: '/gallery*'·'/catalog*' 가 '/:id' 보다 먼저여야 한다 (Express 순차 매칭).
 *
 * @see data/repositories/user-extension-repository
 * @see data/repositories/extension-catalog-repository
 */
import { Router, Request } from 'express';
import { isAdminRole } from '../data/user-manager';
import { z } from 'zod';
import { requireAuth, requireAdmin } from '../auth/middleware';
import { validate } from '../middlewares/validation';
import { getPool } from '../data/models/unified-database';
import { releaseLinkedMcpServers } from '../services/extensions/release-linked-mcp';
import { UserExtensionRepository, type UserExtensionRow } from '../data/repositories/user-extension-repository';
import { ExtensionCatalogRepository, toPublicCatalogSource } from '../data/repositories/extension-catalog-repository';
import { buildExtensionIngestService } from '../services/extensions/ingest-service-factory';
import { syncCatalogSource } from '../services/extensions/catalog-sync';
import { EXTENSION_CATALOG_SYNC_LIMITS, normalizeCatalogSubpath } from '../config/extension-catalog-sync';
import { CATALOG_INDEX_LIMITS, normalizeCatalogIndexUrl } from '../config/extension-catalog-index';
import { encryptToken } from '../utils/token-crypto';
import { NAMED_INSTALL_LIMITS, isValidMarketplaceAlias } from '../config/extension-named-install';
import { registerNamedInstallRoutes } from './user-extensions-named.routes';
import { registerOrgOwnedRoutes } from './user-extensions-org-owned.routes';
import { applyDefaultCatalogAlias } from '../services/extensions/catalog-alias';
import { createLogger } from '../utils/logger';
import { removeExtensionInstallation } from '../services/addon/addon-state';
import { activeOrgFor, membershipsFor } from '../services/org/membership-cache';
import { success, internalError, unauthorized, notFound, badRequest, conflict } from '../utils/api-response';
import { ExtensionSourceBlockedError } from '../errors/extension-source-blocked.error';
import { extensionInstallPreviewEnabled } from '../config/extension-install-preview';

const updateCheckSchema = z.object({
    // private repo 접근/rate limit 우회용 (요청 한정 — DB 미저장)
    accessToken: z.string().max(200).optional(),
});

const visibilitySchema = z.object({
    visibility: z.enum(['private', 'shared', 'organization']),
});

const galleryInstallSchema = z.object({
    // 공유 확장이 private repo 인 경우 설치자 본인의 token (요청 한정 — DB 미저장)
    accessToken: z.string().max(200).optional(),
});

const catalogRegisterSchema = z.object({
    url: z.string().min(3).max(500),
    accessToken: z.string().max(200).optional(),
    // 저장소 안 카탈로그 루트(M4) — 생략 = 저장소 루트(종전)
    sourceSubpath: z.string().max(EXTENSION_CATALOG_SYNC_LIMITS.SUBPATH_MAX_CHARS).nullable().optional(),
});

/** 원본 접근 토큰 — null 이면 삭제. 응답에 값을 돌려주지 않는다(write-only) */
const catalogCredentialSchema = z.object({
    token: z.string().min(1).max(EXTENSION_CATALOG_SYNC_LIMITS.CREDENTIAL_MAX_CHARS).nullable(),
});

/** 원본 설정 — 보낸 필드만 바꾼다(하위 경로 M4 · 정적 색인 주소 M6). null = 지움 */
const catalogPatchSchema = z.object({
    sourceSubpath: z.string().max(EXTENSION_CATALOG_SYNC_LIMITS.SUBPATH_MAX_CHARS).nullable().optional(),
    // 이름 설치 별칭(M5) — null 이면 지워 스냅샷 name 을 쓴다
    alias: z.string().max(NAMED_INSTALL_LIMITS.NAME_MAX_CHARS).nullable().optional(),
    // 정적 색인 주소(M6) — null 이면 색인 미사용(종전 동기화)
    indexUrl: z.string().max(CATALOG_INDEX_LIMITS.URL_MAX_CHARS).nullable().optional(),
}).refine((b) => b.sourceSubpath !== undefined || b.alias !== undefined || b.indexUrl !== undefined, '변경할 항목이 없습니다');

const catalogInstallSchema = z.object({
    // marketplace 소스면 플러그인 이름 필수, 단일 plugin.json 소스면 생략 가능
    plugin: z.string().max(120).optional(),
    accessToken: z.string().max(200).optional(),
});

const log = createLogger('UserExtensionsController');

/** 원본 정책 거절(403 EXTENSION_SOURCE_BLOCKED)은 기존 400 변환을 타지 않고 전역 errorHandler 로 넘긴다 */
function rethrowPolicyError(err: unknown): void {
    if (err instanceof ExtensionSourceBlockedError) throw err;
}

function getUserId(req: Request): string | null {
    if (!req.user) return null;
    if ('userId' in req.user && typeof (req.user as { userId?: unknown }).userId === 'string') {
        return (req.user as { userId: string }).userId;
    }
    if ('id' in req.user) return String(req.user.id);
    return null;
}

/**
 * 응답에서 내부 필드(source_hash, user_id, 승인자 id) 제외. 조직 소유(212) 열은 싣지 않고 — 사람 소유 행의 응답 모양은
 * 마이그레이션 전과 같다 — 조직 소유 행만 `orgOwned: true` 를 붙인다(설치자 id 는 싣지 않는다).
 */
function toPublic(row: UserExtensionRow) {
    const { source_hash: _hash, user_id: _uid, permissions_reviewed_by: _reviewer, ...rest } = row as UserExtensionRow & { owner_org_id?: string | null; installed_by_user_id?: string | null };
    const { owner_org_id: ownerOrg, installed_by_user_id: _installer, ...base } = rest;
    return ownerOrg ? { ...base, orgOwned: true } : base;
}

/** 요청자가 멤버인 조직 id — 조직에 공개된 확장의 갤러리 노출·설치 판정에 쓴다 (조회 실패는 빈 목록 = 조직 공개분만 안 보인다) */
async function memberOrgIds(userId: string): Promise<string[]> {
    try {
        return (await membershipsFor(userId)).map((m) => m.orgId);
    } catch {
        return [];
    }
}

/** ExtensionIngestService 조립 — services/extensions/ingest-service-factory (카탈로그 주기 동기화와 공용) */
const buildIngestService = buildExtensionIngestService;

/** 설치 결과 응답 — 카탈로그 설치·이름 설치 공용 */
function installSummary(result: Extract<Awaited<ReturnType<Awaited<ReturnType<typeof buildIngestService>>['import']>>, { extensionId: string }>) {
    return {
        extensionId: result.extensionId,
        name: result.name,
        version: result.version,
        updated: result.updated ?? false,
        upToDate: (result.upToDate ?? false) || result.deduped,
        skills: result.skills,
        mcpServers: result.mcpServers,
        agents: result.agents,
        validationWarnings: result.validationWarnings,
    };
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
            const rows = await repo.listShared(undefined, await memberOrgIds(userId));
            // 타인 user_id 는 노출하지 않고 owned 플래그만 제공 (user_agents 관용구 동형)
            const extensions = rows.map((r) => ({ ...toPublic(r), owned: r.user_id === userId }));
            // admin 큐레이션 카탈로그 (enabled 소스만) — 실패해도 갤러리 자체는 응답 (fail-open)
            let catalog: Array<Record<string, unknown>> = [];
            try {
                const catRepo = new ExtensionCatalogRepository(getPool());
                catalog = (await catRepo.listEnabled()).map((c) => ({
                    id: c.id, url: c.url, name: c.name, description: c.description,
                    plugins: c.plugins, last_synced_at: c.last_synced_at,
                }));
            } catch (err) {
                log.warn('catalog 조회 실패 (갤러리는 계속):', err);
            }
            // 설치 미리보기(M1b) — 켜져 있을 때만 필드를 싣는다(꺼져 있으면 응답 모양이 종전과 같다)
            res.json(success({ extensions, catalog, ...(extensionInstallPreviewEnabled() ? { installPreview: true } : {}) }));
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
            const shared = await repo.getInstallableById(req.params.id, userId, await memberOrgIds(userId));
            if (!shared) { res.status(404).json(notFound('공유 확장 없음')); return; }

            const body = req.body as z.infer<typeof galleryInstallSchema>;
            const service = await buildIngestService({ userId, isAdmin: isAdminRole(req.user?.role) });
            // 설치자 본인 계정으로 동일 소스 ingest 재실행 — 구성요소는 본인 소유 draft 로 생성
            const result = await service.import({
                userId,
                isAdmin: false,
                gitUrl: shared.source_url,
                gitRef: shared.tracking_ref ?? undefined,
                gitPath: shared.source_path,
                // 합성 매니페스트 설치본(plugin.json 없는 마켓 엔트리)의 이름 — 가상 source_path 재설치 시 사용
                plugin: shared.name,
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

    // ── admin 큐레이션 카탈로그 (⚠️ '/:id' 보다 먼저 등록) ─────────────────────

    router.get('/catalog/admin', requireAuth, requireAdmin, async (_req, res) => {
        try {
            const repo = new ExtensionCatalogRepository(getPool());
            // 원본 토큰 암호문은 싣지 않는다 — 저장 여부(has_credential)만 (write-only)
            res.json(success({ sources: (await repo.listAll()).map(toPublicCatalogSource) }));
        } catch (err) {
            log.error('catalog admin list 실패:', err);
            res.status(500).json(internalError('카탈로그 목록 조회 실패'));
        }
    });

    router.post('/catalog', requireAuth, requireAdmin, validate(catalogRegisterSchema), async (req, res) => {
        const userId = getUserId(req);
        if (!userId) { res.status(401).json(unauthorized()); return; }
        try {
            const body = req.body as z.infer<typeof catalogRegisterSchema>;
            const repo = new ExtensionCatalogRepository(getPool());
            const dup = await repo.findByUrl(body.url.trim());
            if (dup) { res.status(400).json(badRequest(`이미 등록된 소스입니다 (${dup.id})`)); return; }

            let subpath: string | null;
            try { subpath = normalizeCatalogSubpath(body.sourceSubpath); } catch (e) {
                res.status(400).json(badRequest(e instanceof Error ? e.message : String(e))); return;
            }
            const service = await buildIngestService();
            const snapshot = await service.fetchCatalogSnapshot(body.url.trim(), body.accessToken, { userId, action: 'catalog-register' }, subpath);
            const inserted = await repo.insert({
                url: body.url.trim(),
                name: snapshot.name,
                description: snapshot.description,
                plugins: snapshot.plugins,
                addedBy: userId,
            });
            const withSubpath = subpath ? (await repo.setSubpath(inserted.id, subpath)) ?? inserted : inserted;
            // 이름 설치 별칭 기본값 = 스냅샷 name (규칙에 맞고 다른 원본이 안 쓸 때만 — 충돌이면 비워 두고 관리자가 지정)
            const row = await applyDefaultCatalogAlias(repo, withSubpath);
            log.info(`카탈로그 소스 등록: ${row.id} "${row.name}" (${row.plugins.length} plugins, by=${userId})`);
            res.json(success({ source: toPublicCatalogSource(row) }));
            // 설명 한국어 번역 — 응답 후 백그라운드 (LLM 배치가 CF 100s 상한을 넘을 수 있어 동기 금지, fail-open)
            void service.translateCatalogSnapshot(snapshot)
                .then(() => repo.updateSnapshot(row.id, snapshot))
                .catch((e) => log.warn(`catalog 번역 실패 (등록은 완료): ${e instanceof Error ? e.message : String(e)}`));
        } catch (err) {
            rethrowPolicyError(err);
            const msg = err instanceof Error ? err.message : String(err);
            log.warn(`catalog 등록 실패: ${msg}`);
            res.status(400).json(badRequest(`카탈로그 등록 실패: ${msg}`));
        }
    });

    router.post('/catalog/:id/sync', requireAuth, requireAdmin, validate(galleryInstallSchema), async (req, res) => {
        try {
            const repo = new ExtensionCatalogRepository(getPool());
            const row = await repo.getById(req.params.id);
            if (!row) { res.status(404).json(notFound('카탈로그 소스 없음')); return; }
            const service = await buildIngestService();
            // accessToken(요청 한정) > 저장된 원본 토큰(M4) — GitHub API 무인증 rate limit(60/hr) 회피 (2026-08-16 실측)
            const body = req.body as z.infer<typeof galleryInstallSchema>;
            // 결과(sync_status·last_sync_error·last_sync_attempt_at)는 syncCatalogSource 가 기록한다 — 실패도 기록 후 다시 던진다
            const { row: updated, snapshot } = await syncCatalogSource({ repo, service }, row, {
                accessToken: body.accessToken, userId: getUserId(req) ?? undefined,
            });
            log.info(`카탈로그 동기화: ${row.id} (${snapshot.plugins.length} plugins)`);
            res.json(success({ source: updated ? toPublicCatalogSource(updated) : null }));
            // 설명 한국어 번역 — 응답 후 백그라운드 (CF 100s 상한 회피, fail-open)
            void service.translateCatalogSnapshot(snapshot, row.plugins)
                .then(() => repo.updateSnapshot(row.id, snapshot))
                .catch((e) => log.warn(`catalog 번역 실패 (동기화는 완료): ${e instanceof Error ? e.message : String(e)}`));
        } catch (err) {
            rethrowPolicyError(err);
            const msg = err instanceof Error ? err.message : String(err);
            log.warn(`catalog 동기화 실패: ${msg}`);
            res.status(400).json(badRequest(`카탈로그 동기화 실패: ${msg}`));
        }
    });

    // 원본 접근 토큰 — 암호화 저장(write-only). 응답·로그에 값을 남기지 않는다 (M4)
    router.put('/catalog/:id/credential', requireAuth, requireAdmin, validate(catalogCredentialSchema), async (req, res) => {
        try {
            const body = req.body as z.infer<typeof catalogCredentialSchema>;
            const repo = new ExtensionCatalogRepository(getPool());
            const ok = await repo.setCredential(req.params.id, body.token ? encryptToken(body.token) : null);
            if (!ok) { res.status(404).json(notFound('카탈로그 소스 없음')); return; }
            log.info(`카탈로그 원본 토큰 ${body.token ? '저장' : '삭제'}: ${req.params.id} (by=${getUserId(req)})`);
            res.json(success({ id: req.params.id, has_credential: !!body.token }));
        } catch (err) {
            log.error('catalog credential 실패:', err instanceof Error ? err.message : 'unknown');
            res.status(500).json(internalError('원본 토큰 저장 실패'));
        }
    });

    // 하위 경로(M4)·정적 색인 주소(M6) 지정 — 다음 동기화부터 반영된다
    router.patch('/catalog/:id', requireAuth, requireAdmin, validate(catalogPatchSchema), async (req, res) => {
        try {
            const body = req.body as z.infer<typeof catalogPatchSchema>;
            // 형식 검사는 쓰기 전에 모두 — 하나라도 틀리면 아무것도 바꾸지 않는다
            let indexUrl: string | null | undefined;
            try {
                if (body.indexUrl !== undefined) indexUrl = normalizeCatalogIndexUrl(body.indexUrl);
            } catch (e) {
                res.status(400).json(badRequest(e instanceof Error ? e.message : String(e))); return;
            }
            const repo = new ExtensionCatalogRepository(getPool());
            let row = await repo.getById(req.params.id);
            if (!row) { res.status(404).json(notFound('카탈로그 소스 없음')); return; }
            if (body.sourceSubpath !== undefined) {
                let subpath: string | null;
                try { subpath = normalizeCatalogSubpath(body.sourceSubpath); } catch (e) {
                    res.status(400).json(badRequest(e instanceof Error ? e.message : String(e))); return;
                }
                row = (await repo.setSubpath(row.id, subpath)) ?? row;
                log.info(`카탈로그 하위 경로: ${row.id} → ${subpath ?? '(루트)'}`);
            }
            if (body.alias !== undefined) {
                const alias = body.alias?.trim() || null;
                if (alias && !isValidMarketplaceAlias(alias)) {
                    res.status(400).json(badRequest(`INVALID_CATALOG_ALIAS: "${alias}" — 영문·숫자·. _ -, 영문·숫자로 시작, .. 금지, 예약어(internal·builtin·local) 불가`));
                    return;
                }
                const r = await repo.setAlias(row.id, alias);
                if (r.conflict) { res.status(409).json(conflict(`별칭 "${alias}" 는 다른 카탈로그가 쓰고 있습니다`)); return; }
                row = r.row ?? row;
                log.info(`카탈로그 별칭: ${row.id} → ${alias ?? '(스냅샷 name)'}`);
            }
            if (indexUrl !== undefined) {
                row = (await repo.setIndexUrl(row.id, indexUrl)) ?? row;
                log.info(`카탈로그 정적 색인: ${row.id} → ${indexUrl ? 'set' : '(미사용)'}`);
            }
            res.json(success({ source: toPublicCatalogSource(row) }));
        } catch (err) {
            log.error('catalog patch 실패:', err);
            res.status(500).json(internalError('카탈로그 설정 변경 실패'));
        }
    });

    router.delete('/catalog/:id', requireAuth, requireAdmin, async (req, res) => {
        try {
            const repo = new ExtensionCatalogRepository(getPool());
            const ok = await repo.remove(req.params.id);
            if (!ok) { res.status(404).json(notFound('카탈로그 소스 없음')); return; }
            log.info(`카탈로그 소스 삭제: ${req.params.id}`);
            res.json(success({ removed: true }));
        } catch (err) {
            log.error('catalog 삭제 실패:', err);
            res.status(500).json(internalError('카탈로그 삭제 실패'));
        }
    });

    // 이름 설치(M5)·그 미리보기 — user-extensions-named.routes (같은 설치 입력 namedInstallInput)
    registerNamedInstallRoutes(router, { getUserId, rethrowPolicyError, installSummary });
    // 조직 소유 설치(P8, opt-in EXTENSION_ORG_OWNED_INSTALL_ENABLED) — OFF 면 next('route') 로 종전 라우트에 넘긴다
    registerOrgOwnedRoutes(router, { getUserId });

    // 설치 미리보기(M1b, opt-in) — 쓰기·LLM 없이 설치될 구성요소·권한·원본·커밋·경고. 플래그 OFF 면 404(라우트가 없는 것과 같다)
    router.post('/catalog/:id/preview', requireAuth, validate(catalogInstallSchema), async (req, res) => {
        if (!extensionInstallPreviewEnabled()) { res.status(404).json(notFound('설치 미리보기가 꺼져 있습니다')); return; }
        const userId = getUserId(req);
        if (!userId) { res.status(401).json(unauthorized()); return; }
        try {
            const source = await new ExtensionCatalogRepository(getPool()).getById(req.params.id);
            if (!source || !source.enabled) { res.status(404).json(notFound('카탈로그 소스 없음')); return; }
            const body = req.body as z.infer<typeof catalogInstallSchema>;
            const service = await buildIngestService();
            // 설치(아래)와 같은 입력 — 설치자 본인 계정·isAdmin=false
            const result = await service.preview({ userId, isAdmin: false, gitUrl: source.url, plugin: body.plugin, accessToken: body.accessToken, catalogSubpath: source.source_subpath ?? null });
            if ('selectionRequired' in result && result.selectionRequired) {
                const names = result.marketplace?.plugins.map(p => p.name).join(', ');
                res.status(400).json(badRequest(`플러그인 이름을 지정하세요${names ? ` — 가능: ${names}` : ''}`));
                return;
            }
            res.json(success(result));
        } catch (err) {
            rethrowPolicyError(err);
            const msg = err instanceof Error ? err.message : String(err);
            log.warn(`catalog preview 실패: ${msg}`);
            res.status(400).json(badRequest(`설치 미리보기 실패: ${msg}`));
        }
    });

    router.post('/catalog/:id/install', requireAuth, validate(catalogInstallSchema), async (req, res) => {
        const userId = getUserId(req);
        if (!userId) { res.status(401).json(unauthorized()); return; }
        try {
            const repo = new ExtensionCatalogRepository(getPool());
            const source = await repo.getById(req.params.id);
            if (!source || !source.enabled) { res.status(404).json(notFound('카탈로그 소스 없음')); return; }

            const body = req.body as z.infer<typeof catalogInstallSchema>;
            const service = await buildIngestService();
            // 설치자 본인 계정으로 ingest — 갤러리 설치와 동일 시맨틱 (권한 상승 없음)
            const result = await service.import({
                userId,
                isAdmin: false,
                gitUrl: source.url,
                plugin: body.plugin,
                accessToken: body.accessToken,
                catalogSubpath: source.source_subpath ?? null,
            });
            if ('selectionRequired' in result && result.selectionRequired) {
                const names = result.marketplace?.plugins.map(p => p.name).join(', ');
                res.status(400).json(badRequest(`플러그인 이름을 지정하세요${names ? ` — 가능: ${names}` : ''}`));
                return;
            }
            log.info(`catalog install: ${source.id}/${body.plugin ?? '(single)'} → ${result.extensionId} (user=${userId})`);
            res.json(success(installSummary(result)));
        } catch (err) {
            rethrowPolicyError(err);
            const msg = err instanceof Error ? err.message : String(err);
            log.warn(`catalog install 실패: ${msg}`);
            res.status(400).json(badRequest(`카탈로그 설치 실패: ${msg}`));
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
            // organization 공개는 요청자의 활성 조직(멤버십 검증 완료)에만 — 임의 org_id 를 받지 않는다 (user_agents 와 같은 규칙)
            const activeOrg = body.visibility === 'organization' ? await activeOrgFor(userId) : null;
            if (body.visibility === 'organization' && !activeOrg) {
                res.status(400).json(badRequest('활성 조직이 없습니다. 먼저 조직을 선택하세요.'));
                return;
            }
            const row = await repo.setVisibility(req.params.id, userId, body.visibility, activeOrg?.orgId ?? null);
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

            const service = await buildIngestService({ userId, isAdmin: isAdminRole(req.user?.role) });
            const body = req.body as z.infer<typeof updateCheckSchema>;
            const result = await service.checkForUpdate({
                sourceUrl: row.source_url,
                sourcePath: row.source_path,
                currentRef: row.source_ref,
                trackingRef: row.tracking_ref,
                accessToken: body.accessToken,
                userId,
            });
            res.json(success({ ...result, currentVersion: row.version }));
        } catch (err) {
            rethrowPolicyError(err);
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
            // 설치 상태 표에서도 지운다 — 남겨 두면 관리 화면이 지운 확장을 계속 보여 준다.
            await removeExtensionInstallation(removed.id);
            // 회수한(archived·enabled=false) MCP 서버의 떠 있는 연결을 닫는다 — 제거한 확장의 프로세스가 계속 돌지 않게.
            // remove 는 링크를 남기므로(unlink=false) 지금 조회해도 대상이 나온다. 실패해도 제거는 유지.
            const releasedServers = await releaseLinkedMcpServers(getPool(), removed.id, String(removed.user_id));
            log.info(`확장 제거: userId=${userId} id=${removed.id} name=${removed.name} released=${releasedServers}`);
            res.json(success({ extension: toPublic(removed), releasedServers }));
        } catch (err) {
            log.error('remove 실패:', err);
            res.status(500).json(internalError('확장 제거 실패'));
        }
    });

    return router;
}
