/**
 * MCP 카탈로그 + from-catalog + start/stop + instances REST API.
 *
 * `/api/mcp` prefix 에 마운트되며 mcp.routes 와 분리되어 있다 — 책임 분리:
 *   - mcp.routes.ts        : 기존 servers CRUD (admin global + user 등록 visibility 분기)
 *   - mcp-catalog.routes.ts: 카탈로그 select → from-catalog 등록 + lifecycle 조회
 *
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
import { getLifecycleSupervisor } from '../mcp/lifecycle-supervisor';
import { createLogger } from '../utils/logger';

const logger = createLogger('McpCatalogRoutes');

export const mcpCatalogRouter = Router();

// GET /api/mcp/catalog — 전체 카탈로그 (제한 없음)
mcpCatalogRouter.get('/catalog', requireAuth, asyncHandler(async (_req: Request, res: Response) => {
    const repo = new McpCatalogRepository(getUnifiedDatabase().getPool());
    const templates = await repo.listCatalog();
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

        // 설치 즉시 spawn — auto_spawn 서버를 바로 풀에 연결해 재로그인/다음 채팅을 기다리지 않고
        // LLM 도구로 사용 가능하게 한다(완전 통합). best-effort: spawn 실패해도 등록은 유지되며
        // 다음 onChatStart 가 멱등 재시도한다. createFromCatalog 는 enabled=TRUE 고정이라 auto_spawn 만 확인.
        if (created.auto_spawn) {
            const supervisor = getLifecycleSupervisor();
            if (supervisor) {
                try {
                    await supervisor.spawnUserServer(actor.id, created.id);
                    logger.info(`from-catalog 즉시 spawn 성공: ${created.id}`);
                } catch (e) {
                    logger.warn(`from-catalog 즉시 spawn 실패(등록 유지): ${created.id}: ${e instanceof Error ? e.message : String(e)}`);
                }
            }
        }
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

// POST /api/mcp/servers/:id/instances/health-check — Phase 5.2: pid 기반 alive 검증
mcpCatalogRouter.post('/servers/:id/instances/health-check', requireAuth, asyncHandler(async (req: Request, res: Response) => {
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
    const result = await repo.verifyRunningInstancesByPid(req.params.id, ownerId);
    logger.info(`health-check ${req.params.id}: verified=${result.verified} declaredDead=${result.declaredDead} missingPid=${result.missingPid}`);
    res.json(success({ result }));
}));

// GET /api/mcp/instances/summary — Phase 5: 사용자 전체 통합 summary
mcpCatalogRouter.get('/instances/summary', requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const userId = String(req.user?.id ?? '');
    const repo = new McpCatalogRepository(getUnifiedDatabase().getPool());
    const summary = await repo.getUserInstancesSummary(userId);
    res.json(success({ summary }));
}));

// POST /api/mcp/servers/:id/start — lifecycle-supervisor 를 통해 실제 spawn
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
    // ownerId: user_private/user_shared 는 server.user_id, global 은 actor.id
    // — supervisor 내부에서 owner 불일치 시 throw
    const ownerId = server.user_id ?? actor.id;
    const supervisor = getLifecycleSupervisor();
    if (!supervisor) {
        res.status(503).json({ ok: false, error: 'lifecycle-supervisor 미초기화' });
        return;
    }
    try {
        await supervisor.spawnUserServer(ownerId, server.id);
        logger.info(`start 성공 s=${server.id} owner=${ownerId} actor=${actor.id}`);
        res.status(202).json(success({ status: 'running' }));
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        logger.error(`start 실패 s=${server.id}: ${msg}`);
        await repo.recordInstanceTransition(server.id, actor.id, 'crashed', undefined, msg).catch(() => { /* noop */ });
        res.status(500).json({ ok: false, error: msg });
    }
}));

// POST /api/mcp/servers/:id/stop — lifecycle-supervisor 의 kill + DB 'stopped'
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
    const ownerId = server.user_id ?? actor.id;
    const supervisor = getLifecycleSupervisor();
    if (supervisor) {
        await supervisor.killUserServer(ownerId, server.id).catch(e => {
            logger.warn(`kill 실패 s=${server.id}: ${e instanceof Error ? e.message : String(e)}`);
        });
    }
    // killUserServer 가 pool 비어있을 때 일찍 return 하므로 transition 보장 위해 명시 호출
    await repo.recordInstanceTransition(server.id, actor.id, 'stopped').catch(() => { /* noop */ });
    res.status(202).json(success({ status: 'stopped' }));
}));
