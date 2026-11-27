/**
 * MCP admin monitoring routes (Phase 5.3).
 *
 * 엔드포인트 (모두 admin 전용 — requireAuth + requireAdmin):
 *   GET /admin/mcp/monitoring/summary       — 전역 instance summary
 *   GET /admin/mcp/monitoring/top-crashed   — crash count desc top 10
 *   GET /admin/mcp/monitoring/crash-trend   — 24h spawn/crash timeline
 *   GET /admin/mcp/negotiation              — 서버별 협상 관측(MCP-1, MCP_NEGOTIATION_OBSERVE_ENABLED 일 때 쌓인다)
 *   /admin/mcp/servers/*                     — 관리자 bridge 허용 옵션(mcp-admin-servers.routes, 2026-11-08 점검 후속)
 *
 * @module routes/mcp-admin-monitoring.routes
 */
import { Router, type Request, type Response } from 'express';
import { requireAuth, requireAdmin } from '../../../auth';
import { asyncHandler } from '../../../utils/error-handler';
import { success } from '../../../utils/api-response';
import { McpAdminMonitoringRepository } from '../data/mcp-admin-monitoring-repository';
import { getUnifiedDatabase } from '../../../data/models/unified-database';
import { mcpAdminServersRouter } from './mcp-admin-servers.routes';
import { McpNegotiationRepository } from '../data/mcp-negotiation-repository';
import { isNegotiationObserveEnabled } from '../negotiation-observer';

export const mcpAdminMonitoringRouter = Router();
mcpAdminMonitoringRouter.use(requireAuth, requireAdmin);
// 관리자 게이트를 이 라우터에서 물려받는다 — 새 파일이 auth 를 직접 import 하지 않도록(add-on 경계 래칫).
mcpAdminMonitoringRouter.use(mcpAdminServersRouter);

mcpAdminMonitoringRouter.get('/monitoring/summary', asyncHandler(async (_req: Request, res: Response) => {
    const repo = new McpAdminMonitoringRepository(getUnifiedDatabase().getPool());
    const summary = await repo.getGlobalInstanceSummary();
    res.json(success({ summary }));
}));

mcpAdminMonitoringRouter.get('/monitoring/top-crashed', asyncHandler(async (req: Request, res: Response) => {
    const limit = Math.min(Math.max(parseInt(String(req.query.limit ?? '10'), 10) || 10, 1), 50);
    const repo = new McpAdminMonitoringRepository(getUnifiedDatabase().getPool());
    const items = await repo.getTopCrashedServers(limit);
    res.json(success({ items, limit }));
}));

mcpAdminMonitoringRouter.get('/monitoring/crash-trend', asyncHandler(async (_req: Request, res: Response) => {
    const repo = new McpAdminMonitoringRepository(getUnifiedDatabase().getPool());
    const timeline = await repo.getCrashTrendByHour();
    res.json(success({ timeline }));
}));

/** 협상 관측 목록 — 관리자 현황(M3)·호환 판정(M1)의 입력. 플래그가 꺼져 있으면 기록이 늘지 않을 뿐 조회는 된다 */
mcpAdminMonitoringRouter.get('/negotiation', asyncHandler(async (req: Request, res: Response) => {
    const repo = new McpNegotiationRepository(getUnifiedDatabase().getPool());
    const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
    const limitRaw = parseInt(String(req.query.limit ?? ''), 10);
    const items = await repo.list({
        transport: str(req.query.transport),
        protocolEra: str(req.query.protocolEra),
        limit: Number.isFinite(limitRaw) ? limitRaw : undefined,
    });
    res.json(success({ items, observeEnabled: isNegotiationObserveEnabled() }));
}));
