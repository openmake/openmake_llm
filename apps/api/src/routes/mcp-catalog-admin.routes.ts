/**
 * MCP catalog admin CRUD REST 라우터 (Phase 4.6).
 *
 * 엔드포인트 (모두 admin 전용 — requireAdmin):
 *   GET    /admin/mcp/catalog            — 전체 (disabled 포함)
 *   POST   /admin/mcp/catalog            — 신규 template
 *   GET    /admin/mcp/catalog/:id        — 단건
 *   PUT    /admin/mcp/catalog/:id        — 부분 수정
 *   DELETE /admin/mcp/catalog/:id        — 영구 삭제
 *   GET/PUT/DELETE /admin/mcp/catalog/:id/oauth-client — 사전 등록 OAuth 클라이언트(155, 계획 R-3; secret write-only)
 *
 * @module routes/mcp-catalog-admin.routes
 */
import { Router, type Request, type Response } from 'express';
import { requireAuth, requireAdmin } from '../auth';
import { asyncHandler } from '../utils/error-handler';
import { success, notFound } from '../utils/api-response';
import {
    createCatalogTemplateSchema,
    updateCatalogTemplateSchema,
    catalogOAuthClientSchema,
} from '../schemas/mcp-catalog-admin.schema';
import { McpCatalogOAuthClientRepository } from '../data/repositories/mcp-catalog-oauth-client-repository';
import { resolveMcpOAuthRedirectUrl } from '../config/mcp-oauth';
import { getAuditService } from '../services/AuditService';
import { McpCatalogAdminRepository } from '../data/repositories/mcp-catalog-admin-repository';
import { getUnifiedDatabase } from '../data/models/unified-database';
import { createLogger } from '../utils/logger';

const logger = createLogger('McpCatalogAdminRoutes');

export const mcpCatalogAdminRouter = Router();

// 모든 라우트 admin 강제
mcpCatalogAdminRouter.use(requireAuth, requireAdmin);

// GET /catalog — disabled 포함
mcpCatalogAdminRouter.get('/catalog', asyncHandler(async (_req: Request, res: Response) => {
    const repo = new McpCatalogAdminRepository(getUnifiedDatabase().getPool());
    const templates = await repo.listAllForAdmin();
    res.json(success({ templates, total: templates.length }));
}));

// GET /catalog/:id — disabled 포함 단건
mcpCatalogAdminRouter.get('/catalog/:id', asyncHandler(async (req: Request, res: Response) => {
    const repo = new McpCatalogAdminRepository(getUnifiedDatabase().getPool());
    const tpl = await repo.getCatalogTemplateForAdmin(req.params.id);
    if (!tpl) {
        res.status(404).json(notFound('catalog template'));
        return;
    }
    res.json(success({ template: tpl }));
}));

// POST /catalog — 신규
mcpCatalogAdminRouter.post('/catalog', asyncHandler(async (req: Request, res: Response) => {
    const parsed = createCatalogTemplateSchema.safeParse(req.body);
    if (!parsed.success) {
        res.status(400).json({ success: false, error: 'VALIDATION_FAILED', details: parsed.error.issues });
        return;
    }
    const repo = new McpCatalogAdminRepository(getUnifiedDatabase().getPool());
    try {
        const created = await repo.insertCatalogTemplate(parsed.data);
        logger.info(`catalog template created: ${created.id} (by admin)`);
        res.status(201).json(success({ template: created }));
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (/duplicate key|unique/.test(msg)) {
            res.status(409).json({ success: false, error: 'DUPLICATE_ID', message: `id="${parsed.data.id}" already exists` });
            return;
        }
        res.status(500).json({ success: false, error: 'CREATE_FAILED', message: msg });
    }
}));

// PUT /catalog/:id — 부분 수정
mcpCatalogAdminRouter.put('/catalog/:id', asyncHandler(async (req: Request, res: Response) => {
    const parsed = updateCatalogTemplateSchema.safeParse(req.body);
    if (!parsed.success) {
        res.status(400).json({ success: false, error: 'VALIDATION_FAILED', details: parsed.error.issues });
        return;
    }
    const repo = new McpCatalogAdminRepository(getUnifiedDatabase().getPool());
    const updated = await repo.updateCatalogTemplate(req.params.id, parsed.data);
    if (!updated) {
        res.status(404).json(notFound('catalog template'));
        return;
    }
    logger.info(`catalog template updated: ${req.params.id} (by admin)`);
    res.json(success({ template: updated }));
}));

// DELETE /catalog/:id — 영구 삭제
mcpCatalogAdminRouter.delete('/catalog/:id', asyncHandler(async (req: Request, res: Response) => {
    const repo = new McpCatalogAdminRepository(getUnifiedDatabase().getPool());
    const removed = await repo.deleteCatalogTemplate(req.params.id);
    if (!removed) {
        res.status(404).json(notFound('catalog template'));
        return;
    }
    logger.info(`catalog template deleted: ${req.params.id} (by admin)`);
    res.json(success({ id: req.params.id, deleted: true }));
}));

// ── 사전 등록 OAuth 클라이언트(155, 계획 R-3) — 동적 등록을 받지 않는 인가 서버(GitHub·Google)용 ──
// 응답의 redirectUri 는 provider 콘솔(GitHub OAuth App·Google OAuth 클라이언트)에 등록할 콜백 URL 이다.

async function catalogExists(id: string): Promise<boolean> {
    return !!(await new McpCatalogAdminRepository(getUnifiedDatabase().getPool()).getCatalogTemplateForAdmin(id));
}

mcpCatalogAdminRouter.get('/catalog/:id/oauth-client', asyncHandler(async (req: Request, res: Response) => {
    if (!(await catalogExists(req.params.id))) { res.status(404).json(notFound('catalog template')); return; }
    const client = await new McpCatalogOAuthClientRepository(getUnifiedDatabase().getPool()).getView(req.params.id);
    res.json(success({ client: client ?? null, redirectUri: resolveMcpOAuthRedirectUrl() }));
}));

mcpCatalogAdminRouter.put('/catalog/:id/oauth-client', asyncHandler(async (req: Request, res: Response) => {
    const parsed = catalogOAuthClientSchema.safeParse(req.body);
    if (!parsed.success) {
        res.status(400).json({ success: false, error: 'VALIDATION_FAILED', details: parsed.error.issues });
        return;
    }
    if (!(await catalogExists(req.params.id))) { res.status(404).json(notFound('catalog template')); return; }
    const repo = new McpCatalogOAuthClientRepository(getUnifiedDatabase().getPool());
    const b = parsed.data;
    await repo.upsert({
        catalogId: req.params.id, clientId: b.clientId, clientSecret: b.clientSecret,
        tokenEndpointAuthMethod: b.tokenEndpointAuthMethod, scope: b.scope || null,
        authorizationParams: b.authorizationParams, updatedBy: String(req.user!.id),
    });
    // secret 원문·client_id 는 감사 로그에 남기지 않는다 — 무엇이 바뀌었는지만
    await getAuditService().logAudit({
        action: 'mcp_catalog.oauth_client_changed', userId: String(req.user!.id), resourceType: 'mcp_catalog', resourceId: req.params.id,
        details: { secret: b.clientSecret === undefined ? 'kept' : b.clientSecret === null ? 'removed' : 'set', hasScope: !!b.scope },
    });
    logger.info(`catalog oauth client saved: ${req.params.id} (by admin)`);
    res.json(success({ client: await repo.getView(req.params.id), redirectUri: resolveMcpOAuthRedirectUrl() }));
}));

mcpCatalogAdminRouter.delete('/catalog/:id/oauth-client', asyncHandler(async (req: Request, res: Response) => {
    const removed = await new McpCatalogOAuthClientRepository(getUnifiedDatabase().getPool()).delete(req.params.id);
    if (!removed) { res.status(404).json(notFound('oauth client')); return; }
    await getAuditService().logAudit({
        action: 'mcp_catalog.oauth_client_changed', userId: String(req.user!.id), resourceType: 'mcp_catalog', resourceId: req.params.id,
        details: { deleted: true },
    });
    logger.info(`catalog oauth client deleted: ${req.params.id} (by admin)`);
    res.json(success({ id: req.params.id, deleted: true }));
}));
