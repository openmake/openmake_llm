/**
 * MCP admin monitoring routes (Phase 5.3).
 *
 * 엔드포인트 (모두 admin 전용 — requireAuth + requireAdmin):
 *   GET /admin/mcp/monitoring/summary       — 전역 instance summary
 *   GET /admin/mcp/monitoring/top-crashed   — crash count desc top 10
 *   GET /admin/mcp/monitoring/crash-trend   — 24h spawn/crash timeline
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
