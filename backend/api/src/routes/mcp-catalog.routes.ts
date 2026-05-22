/**
 * MCP 카탈로그 + from-catalog + start/stop + instances REST API.
 *
 * `/api/mcp` prefix 에 마운트되며 mcp.routes 와 분리되어 있다 — 책임 분리:
 *   - mcp.routes.ts        : 기존 servers CRUD (admin global + user 등록 visibility 분기)
 *   - mcp-catalog.routes.ts: 카탈로그 select → from-catalog 등록 + lifecycle 조회
 *
 * 참조: docs/superpowers/plans/2026-05-20-phase6-mcp-user-isolation.md §8
 */
import { Router, Request, Response } from 'express';
import { requireAuth } from '../auth';
import { validate } from '../middlewares/validation';
import { asyncHandler } from '../utils/error-handler';
import { success, forbidden, notFound } from '../utils/api-response';
import { McpCatalogRepository } from '../data/repositories/mcp-catalog-repository';
import { canRegisterServer, canStartStopServer } from './mcp-visibility';
import { McpFromCatalogPayloadSchema } from '../schemas/mcp-catalog.schema';
import type { McpFromCatalogPayload } from '../schemas/mcp-catalog.schema';
import { getUnifiedDatabase } from '../data/models/unified-database';
import { createLogger } from '../utils/logger';

const logger = createLogger('McpCatalogRoutes');

export const mcpCatalogRouter = Router();

// GET /api/mcp/catalog — tier 기반 카탈로그
mcpCatalogRouter.get('/catalog', requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const tier = (req.user && 'tier' in req.user ? (req.user as { tier?: string }).tier : 'free') ?? 'free';
    const repo = new McpCatalogRepository(getUnifiedDatabase().getPool());
    const templates = await repo.listCatalog(tier);
    res.json(success({ templates, total: templates.length }));
}));

// POST /api/mcp/servers/from-catalog — 카탈로그 템플릿으로 사용자 서버 등록
mcpCatalogRouter.post(
    '/servers/from-catalog',
    requireAuth,
    validate(McpFromCatalogPayloadSchema),
    asyncHandler(async (req: Request, res: Response) => {
        const userId = String(req.user?.id ?? '');
        const role = req.user?.role ?? 'user';
        const actor = { id: userId, role };
        const payload = req.body as McpFromCatalogPayload;
        const repo = new McpCatalogRepository(getUnifiedDatabase().getPool());

        const template = await repo.getCatalogTemplate(payload.template_id);
        if (!template) {
            res.status(404).json(notFound('catalog template'));
            return;
        }

        // tier 검증
        const tierOrder = ['free', 'starter', 'standard', 'pro', 'enterprise'];
        const userTierIdx = tierOrder.indexOf(
            (req.user && 'tier' in req.user ? (req.user as { tier?: string }).tier : 'free') ?? 'free',
        );
        const requiredTierIdx = tierOrder.indexOf(template.required_tier);
        if (userTierIdx < requiredTierIdx) {
            res.status(403).json(forbidden(`이 템플릿은 ${template.required_tier} 티어 이상 필요`));
            return;
        }

        const check = canRegisterServer(actor, {
            visibility: payload.visibility,
            catalog_template_id: payload.template_id,
        });
        if (!check.allowed) {
            res.status(403).json(forbidden(check.reason));
            return;
        }

        const created = await repo.createFromCatalog(payload, template, actor.id);
        logger.info(`from-catalog 등록: ${created.id} (template=${template.id}, user=${actor.id})`);
        res.status(201).json(success({ server: created }));
    }),
);

// GET /api/mcp/servers/:id/instances — 본인 서버의 lifecycle 인스턴스
mcpCatalogRouter.get('/servers/:id/instances', requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const userId = String(req.user?.id ?? '');
    const role = req.user?.role ?? 'user';
    const actor = { id: userId, role };
    const repo = new McpCatalogRepository(getUnifiedDatabase().getPool());
    const server = await repo.getServerById(req.params.id);
    if (!server) {
        res.status(404).json(notFound('서버'));
        return;
    }
    if (!canStartStopServer(actor, server)) {
        res.status(403).json(forbidden('조회 권한 없음'));
        return;
    }
    const ownerId = server.user_id ?? actor.id;
    const instances = await repo.listInstances(ownerId);
    res.json(success({ instances: instances.filter(i => i.mcp_server_id === server.id) }));
}));

// GET /api/mcp/servers/:id/metrics — Phase 5: aggregate instance metrics
mcpCatalogRouter.get('/servers/:id/metrics', requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const userId = String(req.user?.id ?? '');
    const role = req.user?.role ?? 'user';
    const actor = { id: userId, role };
    const repo = new McpCatalogRepository(getUnifiedDatabase().getPool());
    const server = await repo.getServerById(req.params.id);
    if (!server) {
        res.status(404).json(notFound('서버'));
        return;
    }
    if (!canStartStopServer(actor, server)) {
        res.status(403).json(forbidden('조회 권한 없음'));
        return;
    }
    const ownerId = server.user_id ?? actor.id;
    const metrics = await repo.getServerInstanceMetrics(req.params.id, ownerId);
    res.json(success({ metrics }));
}));

// GET /api/mcp/instances/summary — Phase 5: 사용자 전체 통합 summary
mcpCatalogRouter.get('/instances/summary', requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const userId = String(req.user?.id ?? '');
    const repo = new McpCatalogRepository(getUnifiedDatabase().getPool());
    const summary = await repo.getUserInstancesSummary(userId);
    res.json(success({ summary }));
}));

// POST /api/mcp/servers/:id/start — DB 상태만 'starting' 으로 기록
// 실제 spawn 은 Phase 7 lifecycle-supervisor 가 처리.
mcpCatalogRouter.post('/servers/:id/start', requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const userId = String(req.user?.id ?? '');
    const role = req.user?.role ?? 'user';
    const actor = { id: userId, role };
    const repo = new McpCatalogRepository(getUnifiedDatabase().getPool());
    const server = await repo.getServerById(req.params.id);
    if (!server) {
        res.status(404).json(notFound('서버'));
        return;
    }
    if (!canStartStopServer(actor, server)) {
        res.status(403).json(forbidden('start 권한 없음'));
        return;
    }
    await repo.recordInstanceTransition(server.id, actor.id, 'starting');
    res.status(202).json(success({ status: 'starting', note: 'spawn 은 Phase 7 lifecycle-supervisor 의 책임' }));
}));

// POST /api/mcp/servers/:id/stop — DB 상태만 'stopped' 로 기록
mcpCatalogRouter.post('/servers/:id/stop', requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const userId = String(req.user?.id ?? '');
    const role = req.user?.role ?? 'user';
    const actor = { id: userId, role };
    const repo = new McpCatalogRepository(getUnifiedDatabase().getPool());
    const server = await repo.getServerById(req.params.id);
    if (!server) {
        res.status(404).json(notFound('서버'));
        return;
    }
    if (!canStartStopServer(actor, server)) {
        res.status(403).json(forbidden('stop 권한 없음'));
        return;
    }
    await repo.recordInstanceTransition(server.id, actor.id, 'stopped');
    res.status(202).json(success({ status: 'stopped' }));
}));
