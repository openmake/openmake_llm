/**
 * MCP 서버 설정(mcp_servers) CRUD — 종전 Base `data/repositories/external-repository.ts` 와 `UnifiedDatabase` 위임 메서드에서
 * 옮겼다(2026-10-18, MCP 저장 계층 이전). 쓰는 곳은 이 add-on 뿐이다(서버 등록부·전역 연결 라우트).
 *
 * @module addons/mcp-runtime/data/mcp-server-repository
 */
import { BaseRepository, type QueryParam } from '../../../runtime-ports/db-access';
import { QUERY_ROW_LIMITS } from '../../../config/runtime-limits';

type DbRow = Record<string, unknown>;

export interface MCPServerRow {
    id: string;
    name: string;
    transport_type: string;
    command: string | null;
    args: string[] | null;
    env: Record<string, string> | null;
    url: string | null;
    enabled: boolean;
    created_at: string;
    updated_at: string;
    /** stdio docker 샌드박스 네트워크 정책 ('full'|'none'). 042 마이그레이션. */
    sandbox_network?: 'full' | 'none' | 'host' | null;
    /**
     * 소유자 (NULL=전역 서버).
     *
     * ⚠️ 실행 풀이 갈리는 기준이다 — 사용자 소유 서버는 전역 registry 가 아니라
     * userPool 에 뜨므로, 상태를 registry 만으로 판정하면 연결된 서버도 늘
     * disconnected 로 보인다. `SELECT *` 로 이미 실려 오던 값의 타입 노출.
     */
    user_id?: string | null;
}

export class McpServerRepository extends BaseRepository {
    async getMcpServers(): Promise<MCPServerRow[]> {
        const result = await this.query('SELECT * FROM mcp_servers ORDER BY created_at DESC LIMIT $1', [QUERY_ROW_LIMITS.MCP_SERVERS_MAX]);
        return result.rows.map((row: DbRow) => ({
            ...row,
            args: (row.args as string[] | null) || null,
            env: (row.env as Record<string, string> | null) || null,
            enabled: !!row.enabled
        })) as MCPServerRow[];
    }

    /**
     * 전역(visibility='global') MCP 서버만 반환 — 부팅 시 전역 ToolRouter 등록 전용.
     * user_private/user_shared 서버는 LifecycleSupervisor(사용자 풀)가 userId 격리하여
     * spawn 하므로 전역 맵에 등록하면 안 된다(게스트/타 사용자 과노출 + 중복 spawn 방지).
     */
    async getGlobalMcpServers(): Promise<MCPServerRow[]> {
        const result = await this.query(
            "SELECT * FROM mcp_servers WHERE visibility = 'global' ORDER BY created_at DESC LIMIT $1",
            [QUERY_ROW_LIMITS.MCP_SERVERS_MAX]
        );
        return result.rows.map((row: DbRow) => ({
            ...row,
            args: (row.args as string[] | null) || null,
            env: (row.env as Record<string, string> | null) || null,
            enabled: !!row.enabled
        })) as MCPServerRow[];
    }

    async getMcpServerById(id: string): Promise<MCPServerRow | null> {
        const result = await this.query('SELECT * FROM mcp_servers WHERE id = $1', [id]);
        const row = result.rows[0] as DbRow | undefined;
        if (!row) return null;

        return {
            ...row,
            args: (row.args as string[] | null) || null,
            env: (row.env as Record<string, string> | null) || null,
            enabled: !!row.enabled
        } as MCPServerRow;
    }

    async createMcpServer(server: Omit<MCPServerRow, 'created_at' | 'updated_at'>): Promise<MCPServerRow> {
        const result = await this.query(
            `INSERT INTO mcp_servers (id, name, transport_type, command, args, env, url, enabled)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            RETURNING *`,
            [
                server.id,
                server.name,
                server.transport_type,
                server.command,
                server.args ? JSON.stringify(server.args) : null,
                server.env ? JSON.stringify(server.env) : null,
                server.url,
                server.enabled
            ]
        );
        const row = result.rows[0] as DbRow;
        return {
            ...row,
            args: (row.args as string[] | null) || null,
            env: (row.env as Record<string, string> | null) || null,
            enabled: !!row.enabled
        } as MCPServerRow;
    }

    async updateMcpServer(id: string, updates: Partial<Pick<MCPServerRow, 'name' | 'transport_type' | 'command' | 'args' | 'env' | 'url' | 'enabled'>>): Promise<MCPServerRow | null> {
        const sets: string[] = ['updated_at = NOW()'];
        const params: QueryParam[] = [];
        let paramIdx = 1;

        if (updates.name !== undefined) {
            sets.push(`name = $${paramIdx++}`);
            params.push(updates.name);
        }
        if (updates.transport_type !== undefined) {
            sets.push(`transport_type = $${paramIdx++}`);
            params.push(updates.transport_type);
        }
        if (updates.command !== undefined) {
            sets.push(`command = $${paramIdx++}`);
            params.push(updates.command);
        }
        if (updates.args !== undefined) {
            sets.push(`args = $${paramIdx++}`);
            params.push(updates.args ? JSON.stringify(updates.args) : null);
        }
        if (updates.env !== undefined) {
            sets.push(`env = $${paramIdx++}`);
            params.push(updates.env ? JSON.stringify(updates.env) : null);
        }
        if (updates.url !== undefined) {
            sets.push(`url = $${paramIdx++}`);
            params.push(updates.url);
        }
        if (updates.enabled !== undefined) {
            sets.push(`enabled = $${paramIdx++}`);
            params.push(updates.enabled);
        }

        params.push(id);
        const result = await this.query(
            `UPDATE mcp_servers SET ${sets.join(', ')} WHERE id = $${paramIdx} RETURNING *`,
            params
        );

        const row = result.rows[0] as DbRow | undefined;
        if (!row) return null;

        return {
            ...row,
            args: (row.args as string[] | null) || null,
            env: (row.env as Record<string, string> | null) || null,
            enabled: !!row.enabled
        } as MCPServerRow;
    }

    async deleteMcpServer(id: string): Promise<boolean> {
        const result = await this.query('DELETE FROM mcp_servers WHERE id = $1', [id]);
        return (result.rowCount || 0) > 0;
    }
}

/** 서버 등록부가 쓰는 연산만 — 테스트가 가짜를 넘기기 쉽게 좁힌다 */
export type McpServerRowSource = Pick<McpServerRepository, 'getGlobalMcpServers' | 'createMcpServer' | 'deleteMcpServer'>;
