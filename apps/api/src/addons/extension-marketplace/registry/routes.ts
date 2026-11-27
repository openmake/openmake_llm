/**
 * MCP Registry 라우트 — `/api/extension-marketplace/registry/*`(본 라우터가 마운트). add-on 게이트가 먼저 돈다.
 *
 *   GET  /entries                      — 카탈로그 원본 종류 'mcp-registry' 보기: 관리자가 승인한 항목만(로그인 사용자)
 *   GET  /admin/status                 — 플래그·동기화 상태·큐레이션 건수(관리자)
 *   GET  /admin/entries                — 전체 사본(큐레이션 필터·검색·페이지, 관리자)
 *   PUT  /admin/entries/curation       — {serverName, curation} 승인·숨김·보류(관리자, 감사)
 *   POST /admin/entries/promote        — {serverName} MCP 카탈로그 꺼진 초안으로 올리기(관리자, 감사)
 *   POST /admin/sync                   — 지금 동기화(플래그 ON 일 때만, 관리자)
 *
 * 읽기는 DB 사본만 본다 — 레지스트리가 죽어도 목록·갤러리는 그대로다. 서버 이름에 '/' 가 있어 경로 대신 본문·쿼리로 받는다.
 * "게시자 확인" 은 레지스트리가 네임스페이스 소유를 확인했다는 뜻뿐이다(코드·보안 검토 아님).
 *
 * @module addons/extension-marketplace/registry/routes
 */
import { Router, type Request } from 'express';
import { z } from 'zod';
import { success } from '../../../utils/api-response';
import { AppError, asyncHandler, ValidationError } from '../../../utils/error-handler';
import { createLogger } from '../../../utils/logger';
import { getPool } from '../../../runtime-ports/db-access';
import { isAdminRole } from '../../../runtime-ports/request-auth';
import { recordAddonAudit } from '../../../runtime-ports/audit-port';
import { createMcpCatalogDraft } from '../../../runtime-ports/mcp-catalog-templates';
import { REGISTRY_CURATED_AUDIT_ACTION, REGISTRY_PROMOTED_AUDIT_ACTION } from '../contributions';
import { REGISTRY_SOURCE_ID } from './constants';
import { planCatalogDraft } from './promote';
import { RegistryRepository, type StoredRegistryEntry } from './registry-repository';
import { registrySyncEnabled, triggerRegistrySync } from './runtime';

const logger = createLogger('ExtensionMarketplaceRegistry');

/** 카탈로그 원본 종류 이름 — 갤러리·화면이 원본을 구분하는 값 */
export const REGISTRY_SOURCE_KIND = 'mcp-registry';

const SERVER_NAME = z.string().min(3).max(200).regex(/^[a-zA-Z0-9.-]+\/[a-zA-Z0-9._-]+$/);
const listQuery = z.object({
    curation: z.enum(['all', 'pending', 'approved', 'hidden']).optional(),
    search: z.string().trim().max(100).optional(),
    includeTombstoned: z.enum(['true', 'false']).optional(),
    limit: z.coerce.number().int().min(1).max(200).optional(),
    offset: z.coerce.number().int().min(0).max(1_000_000).optional(),
});
const curationBody = z.object({ serverName: SERVER_NAME, curation: z.enum(['pending', 'approved', 'hidden']) });
const promoteBody = z.object({ serverName: SERVER_NAME });

export interface RegistryRouteDeps {
    repo: () => RegistryRepository;
}

const defaultDeps: RegistryRouteDeps = {
    repo: () => new RegistryRepository(getPool(), REGISTRY_SOURCE_ID),
};

function userId(req: Request): string {
    const u = req.user as { id?: unknown; userId?: unknown } | undefined;
    const id = u?.userId ?? u?.id;
    if (id === undefined || id === null) throw new AppError('인증이 필요합니다', 401, true, 'UNAUTHORIZED');
    return String(id);
}

function assertAdmin(req: Request): string {
    const id = userId(req);
    if (!isAdminRole((req.user as { role?: string } | undefined)?.role)) {
        throw new AppError('관리자 권한이 필요합니다', 403, true, 'FORBIDDEN');
    }
    return id;
}

/** 사용자 보기 — 큐레이션 메모(누가 언제)는 싣지 않는다 */
function publicView(e: StoredRegistryEntry) {
    return {
        serverName: e.serverName, namespace: e.namespace, version: e.version, title: e.title, description: e.description,
        websiteUrl: e.websiteUrl, repositoryUrl: e.repositoryUrl, remotes: e.remotes, packages: e.packages,
        status: e.status, statusMessage: e.statusMessage, publisherVerified: true, promotedCatalogId: e.promotedCatalogId,
    };
}

export function createRegistryRouter(deps: RegistryRouteDeps = defaultDeps): Router {
    const router = Router();

    router.get('/entries', asyncHandler(async (req, res) => {
        userId(req);
        const q = listQuery.safeParse(req.query);
        if (!q.success) throw new ValidationError('잘못된 조회 조건입니다');
        let entries: StoredRegistryEntry[] = [];
        let total = 0;
        let available = true;
        try {
            ({ entries, total } = await deps.repo().list({
                curation: 'approved', search: q.data.search, limit: q.data.limit ?? 50, offset: q.data.offset ?? 0,
            }));
        } catch (err) {
            // 사본 조회 실패도 갤러리를 깨지 않는다 — 빈 목록 + available:false
            available = false;
            logger.warn(`레지스트리 사본 조회 실패(빈 목록): ${err instanceof Error ? err.message : String(err)}`);
        }
        res.json(success({ sourceKind: REGISTRY_SOURCE_KIND, sourceId: REGISTRY_SOURCE_ID, available, total, entries: entries.map(publicView) }));
    }));

    router.get('/admin/status', asyncHandler(async (req, res) => {
        assertAdmin(req);
        const repo = deps.repo();
        const [state, counts] = await Promise.all([repo.getState(), repo.counts()]);
        const backingOff = state.backoffUntil !== null && Date.parse(state.backoffUntil) > Date.now();
        res.json(success({ sourceKind: REGISTRY_SOURCE_KIND, sourceId: REGISTRY_SOURCE_ID, syncEnabled: registrySyncEnabled(), backingOff, state, counts }));
    }));

    router.get('/admin/entries', asyncHandler(async (req, res) => {
        assertAdmin(req);
        const q = listQuery.safeParse(req.query);
        if (!q.success) throw new ValidationError('잘못된 조회 조건입니다');
        const { entries, total } = await deps.repo().list({
            curation: q.data.curation ?? 'all', search: q.data.search, includeTombstoned: q.data.includeTombstoned === 'true',
            limit: q.data.limit ?? 50, offset: q.data.offset ?? 0,
        });
        res.json(success({ total, entries: entries.map(e => ({ ...publicView(e), curation: e.curation, curatedAt: e.curatedAt, tombstonedAt: e.tombstonedAt, lastSeenAt: e.lastSeenAt })) }));
    }));

    router.put('/admin/entries/curation', asyncHandler(async (req, res) => {
        const by = assertAdmin(req);
        const b = curationBody.safeParse(req.body);
        if (!b.success) throw new ValidationError('serverName·curation 이 필요합니다');
        const ok = await deps.repo().setCuration(b.data.serverName, b.data.curation, by);
        if (!ok) throw new AppError('항목이 없거나 레지스트리에서 지워져 승인할 수 없습니다', 404, true, 'REGISTRY_ENTRY_NOT_FOUND');
        await recordAddonAudit({
            action: REGISTRY_CURATED_AUDIT_ACTION, userId: by, resourceType: 'mcp_registry_entry', resourceId: b.data.serverName,
            details: { curation: b.data.curation },
        });
        res.json(success({ serverName: b.data.serverName, curation: b.data.curation }));
    }));

    router.post('/admin/entries/promote', asyncHandler(async (req, res) => {
        const by = assertAdmin(req);
        const b = promoteBody.safeParse(req.body);
        if (!b.success) throw new ValidationError('serverName 이 필요합니다');
        const repo = deps.repo();
        const entry = await repo.get(b.data.serverName);
        if (!entry) throw new AppError('항목이 없습니다', 404, true, 'REGISTRY_ENTRY_NOT_FOUND');
        const plan = planCatalogDraft(entry);
        if (!plan.ok) throw new AppError('카탈로그로 올릴 수 없는 항목입니다', 409, true, `REGISTRY_PROMOTE_${plan.reason}`);
        const result = await createMcpCatalogDraft(plan.input);
        if (result.status === 'unavailable') throw new AppError('MCP 런타임이 꺼져 있어 카탈로그에 올릴 수 없습니다', 409, true, 'MCP_CATALOG_UNAVAILABLE');
        if (result.status === 'invalid') throw new AppError(`카탈로그 입력이 올바르지 않습니다: ${result.message}`, 422, true, 'MCP_CATALOG_INVALID');
        await repo.setPromoted(entry.serverName, result.id);
        await recordAddonAudit({
            action: REGISTRY_PROMOTED_AUDIT_ACTION, userId: by, resourceType: 'mcp_registry_entry', resourceId: entry.serverName,
            details: { catalogId: result.id, status: result.status, version: entry.version, transport: plan.input.transportType },
        });
        res.json(success({ serverName: entry.serverName, catalogId: result.id, status: result.status }));
    }));

    router.post('/admin/sync', asyncHandler(async (req, res) => {
        assertAdmin(req);
        if (!registrySyncEnabled()) throw new AppError('레지스트리 동기화가 꺼져 있습니다', 409, true, 'REGISTRY_SYNC_DISABLED');
        res.json(success({ outcome: await triggerRegistrySync({ force: true }) }));
    }));

    return router;
}

export const registryRouter = createRegistryRouter();
