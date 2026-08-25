/**
 * 전역(admin 등록, visibility=global) MCP 서버의 수동 연결 — 두 라우트가 공유한다.
 *
 *   - POST /api/mcp/servers/:id/connect  (mcp.routes.ts — 커넥터 탭 [연결])
 *   - POST /api/mcp/servers/:id/start    (mcp-catalog.routes.ts — API 호출용)
 *
 * 전역 서버는 유저풀(lifecycle-supervisor)이 아니라 전역 registry 에 띄운다. /start 가 전역도
 * `spawnUserServer(actor.id, …)` 로 보내 `서버 소유자 불일치` 500 을 내던 결함(2026-08-25 실측)을
 * 막기 위해 connect 의 전역 분기를 여기로 뽑았다 — 두 경로가 갈라지면 같은 결함이 재발한다.
 *
 * ⚠️ `getMcpServerById` 는 DB 원본(암호문 v1:)을 돌려주므로 복호화가 필수다. 빠뜨리면
 * 서버는 뜨고 도구 목록도 등록되지만 실제 API 호출만 401 로 실패한다.
 */
import { getUnifiedMCPClient } from '../mcp';
import { getUnifiedDatabase } from '../data/models/unified-database';
import { McpCatalogRepository } from '../data/repositories/mcp-catalog-repository';
import type { MCPConnectionStatus, MCPTransportType } from '../mcp/types';

/** 연결 후 registry 상태를 돌려준다. 서버 row 가 없으면 null (호출자가 404). */
export async function connectGlobalServer(id: string): Promise<MCPConnectionStatus | null | undefined> {
    const db = getUnifiedDatabase();
    const server = await db.getMcpServerById(id);
    if (!server) return null;

    const decryptedEnv = await new McpCatalogRepository(db.getPool()).decryptEnvForSpawn(id);

    const registry = getUnifiedMCPClient().getServerRegistry();
    await registry.connectServer(id, {
        id: server.id,
        name: server.name,
        transport_type: server.transport_type as MCPTransportType,
        command: server.command || undefined,
        args: server.args || undefined,
        env: Object.keys(decryptedEnv).length > 0 ? decryptedEnv : undefined,
        url: server.url || undefined,
        enabled: server.enabled,
        created_at: server.created_at,
        updated_at: server.updated_at,
    });
    return registry.getServerStatus(id);
}
