/**
 * MCP admin monitoring routes (Phase 5.3).
 *
 * 엔드포인트 (모두 admin 전용 — requireAuth + requireAdmin):
 *   GET /admin/mcp/monitoring/summary       — 전역 instance summary
 *   GET /admin/mcp/monitoring/top-crashed   — crash count desc top 10
 *   GET /admin/mcp/monitoring/crash-trend   — 24h spawn/crash timeline
 *
 * @module routes/mcp-admin-monitoring.routes
 */
import { Router, type Request, type Response } from 'express';
import { requireAuth, requireAdmin } from '../auth';
import { asyncHandler } from '../utils/error-handler';
import { success } from '../utils/api-response';
import { McpCatalogRepository } from '../data/repositories/mcp-catalog-repository';
import { getUnifiedDatabase } from '../data/models/unified-database';

export const mcpAdminMonitoringRouter = Router();
mcpAdminMonitoringRouter.use(requireAuth, requireAdmin);

mcpAdminMonitoringRouter.get('/monitoring/summary', asyncHandler(async (_req: Request, res: Response) => {
    const repo = new McpCatalogRepository(getUnifiedDatabase().getPool());
    const summary = await repo.getGlobalInstanceSummary();
    res.json(success({ summary }));
}));

mcpAdminMonitoringRouter.get('/monitoring/top-crashed', asyncHandler(async (req: Request, res: Response) => {
    const limit = Math.min(Math.max(parseInt(String(req.query.limit ?? '10'), 10) || 10, 1), 50);
    const repo = new McpCatalogRepository(getUnifiedDatabase().getPool());
    const items = await repo.getTopCrashedServers(limit);
    res.json(success({ items, limit }));
}));

mcpAdminMonitoringRouter.get('/monitoring/crash-trend', asyncHandler(async (_req: Request, res: Response) => {
    const repo = new McpCatalogRepository(getUnifiedDatabase().getPool());
    const timeline = await repo.getCrashTrendByHour();
    res.json(success({ timeline }));
}));
