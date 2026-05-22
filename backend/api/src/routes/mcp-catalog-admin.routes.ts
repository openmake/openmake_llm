/**
 * MCP catalog admin CRUD REST 라우터 (Phase 4.6).
 *
 * 엔드포인트 (모두 admin 전용 — requireAdmin):
 *   GET    /admin/mcp/catalog            — 전체 (disabled 포함)
 *   POST   /admin/mcp/catalog            — 신규 template
 *   GET    /admin/mcp/catalog/:id        — 단건
 *   PUT    /admin/mcp/catalog/:id        — 부분 수정
 *   DELETE /admin/mcp/catalog/:id        — 영구 삭제
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
} from '../schemas/mcp-catalog-admin.schema';
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
