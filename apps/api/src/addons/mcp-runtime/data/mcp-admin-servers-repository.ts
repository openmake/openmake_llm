/**
 * 관리자 bridge 허용 옵션(2026-11-08 점검 후속) — 사용자 소유 MCP 서버 목록과 sandbox_bridge_allowed 변경.
 * 관리자 전용 라우트(routes/mcp-admin-servers.routes)만 쓴다. owner_email 은 관리자 응답에만 실린다.
 *
 * @module addons/mcp-runtime/data/mcp-admin-servers-repository
 */
import type { Pool } from 'pg';
import { maskEnv, type UserMcpServerRow } from './mcp-catalog-helpers';

export interface UserOwnedMcpServerRow {
    id: string;
    name: string;
    transport_type: 'stdio' | 'sse' | 'streamable-http';
    owner_user_id: string;
    owner_email: string | null;
    sandbox_network: 'full' | 'none' | 'host' | null;
    sandbox_bridge_allowed: boolean;
    enabled: boolean;
    created_at: string;
}

export class McpAdminServersRepository {
    constructor(private pool: Pool) {}

    async listUserOwned(limit = 500): Promise<UserOwnedMcpServerRow[]> {
        const r = await this.pool.query<UserOwnedMcpServerRow>(
            `SELECT s.id, s.name, s.transport_type, s.user_id AS owner_user_id, u.email AS owner_email,
                    s.sandbox_network, s.sandbox_bridge_allowed, s.enabled, s.created_at::text
             FROM mcp_servers s LEFT JOIN users u ON u.id = s.user_id
             WHERE s.user_id IS NOT NULL
             ORDER BY s.created_at DESC
             LIMIT $1`,
            [limit],
        );
        return r.rows;
    }

    async setBridgeAllowed(id: string, allowed: boolean): Promise<UserMcpServerRow | null> {
        const r = await this.pool.query<UserMcpServerRow>(
            `UPDATE mcp_servers SET sandbox_bridge_allowed = $2, updated_at = NOW()
             WHERE id = $1 AND user_id IS NOT NULL
             RETURNING id, user_id, name, transport_type, command, args, env, url,
                       visibility, catalog_template_id, auto_spawn, enabled, sandbox_network, sandbox_bridge_allowed,
                       created_at::text, updated_at::text`,
            [id, allowed],
        );
        return r.rows[0] ? maskEnv(r.rows[0]) : null;
    }
}
