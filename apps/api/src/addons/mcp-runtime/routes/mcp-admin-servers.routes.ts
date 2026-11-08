/**
 * 관리자 bridge 허용 옵션(2026-11-08 점검 후속) — 사용자 소유 MCP 서버의 샌드박스 네트워크 운영 API.
 *
 * 엔드포인트(관리자 전용 — 상위 mcpAdminMonitoringRouter 의 requireAuth + requireAdmin 아래에 붙는다):
 *   GET   /admin/mcp/servers/user-owned            — 사용자 소유 서버 목록(최대 500, 최신순) + 서버가 계산한 effective_network
 *   PATCH /admin/mcp/servers/:id/sandbox-bridge    — body { allowed: boolean }, 사용자 stdio 서버만. 다음 연결부터 적용.
 *
 * @module addons/mcp-runtime/routes/mcp-admin-servers.routes
 */
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../../utils/error-handler';
import { success, badRequest, notFound } from '../../../utils/api-response';
import { createLogger } from '../../../utils/logger';
import { getPool } from '../../../runtime-ports/db-access';
import { McpAdminServersRepository } from '../data/mcp-admin-servers-repository';
import { McpCatalogRepository } from '../data/mcp-catalog-repository';
import { getLifecycleSupervisor } from '../lifecycle-supervisor';
import { defaultSandboxConfig, effectiveNetwork, type EffectiveSandboxNetwork } from '../sandbox-docker';
import { auditMcpServerBridgeChanged } from './mcp-server-audit';

const logger = createLogger('McpAdminServers');

const LIST_LIMIT = 500;

/** PATCH /servers/:id/sandbox-bridge body. */
export const mcpServerSandboxBridgeSchema = z.object({ allowed: z.boolean() }).strict();

/** 사용자 소유 서버의 유효 네트워크 — stdio 만 해당, 그 밖은 null. 화면은 이 값을 라벨로만 그린다. */
function userServerNetwork(
    row: { transport_type: string; sandbox_network?: string | null; sandbox_bridge_allowed?: boolean | null },
    userEgress: boolean,
): EffectiveSandboxNetwork | null {
    if (row.transport_type !== 'stdio') return null;
    const n = row.sandbox_network;
    const network = n === 'none' || n === 'host' ? n : 'full';
    return effectiveNetwork({ network, ownerScope: 'user', bridgeAllowed: row.sandbox_bridge_allowed === true }, { userEgress });
}

export const mcpAdminServersRouter = Router();

mcpAdminServersRouter.get('/servers/user-owned', asyncHandler(async (_req: Request, res: Response) => {
    const rows = await new McpAdminServersRepository(getPool()).listUserOwned(LIST_LIMIT);
    const { userEgress } = defaultSandboxConfig();
    const items = rows.map((r) => ({
        id: r.id, name: r.name, transport_type: r.transport_type, owner_user_id: r.owner_user_id, owner_email: r.owner_email,
        sandbox_network: r.sandbox_network, sandbox_bridge_allowed: r.sandbox_bridge_allowed === true,
        effective_network: userServerNetwork(r, userEgress), enabled: r.enabled, created_at: r.created_at,
    }));
    res.json(success({ items }));
}));

mcpAdminServersRouter.patch('/servers/:id/sandbox-bridge', asyncHandler(async (req: Request, res: Response) => {
    const parsed = mcpServerSandboxBridgeSchema.safeParse(req.body);
    if (!parsed.success) {
        res.status(400).json(badRequest('allowed(boolean) 가 필요합니다'));
        return;
    }
    const { allowed } = parsed.data;
    const id = String(req.params.id);
    const pool = getPool();
    const server = await new McpCatalogRepository(pool).getServerById(id);
    if (!server) {
        res.status(404).json(notFound('서버'));
        return;
    }
    if (!server.user_id) {
        res.status(400).json(badRequest('전역 서버는 대상이 아닙니다'));
        return;
    }
    if (server.transport_type !== 'stdio') {
        res.status(400).json(badRequest('stdio 서버만 해당합니다'));
        return;
    }
    const updated = await new McpAdminServersRepository(pool).setBridgeAllowed(id, allowed);
    if (!updated) {
        res.status(404).json(notFound('서버'));
        return;
    }
    // 떠 있는 클라이언트는 이전 네트워크로 실행 중이다 — 정리해 두면 다음 연결 때 새 값으로 다시 뜬다(env PATCH 와 같은 관례).
    const ownerUserId = String(server.user_id);
    await getLifecycleSupervisor()?.killUserServer(ownerUserId, id).catch((e: unknown) =>
        logger.warn(`bridge 허용 변경 후 유저풀 정리 실패(변경은 유지): ${id}: ${e instanceof Error ? e.message : String(e)}`));
    auditMcpServerBridgeChanged(req, { id, name: server.name, ownerUserId, allowed });
    const { userEgress } = defaultSandboxConfig();
    res.json(success({
        server: { id, sandbox_bridge_allowed: updated.sandbox_bridge_allowed === true, effective_network: userServerNetwork(updated, userEgress) },
        respawnRequired: true,
    }));
}));
