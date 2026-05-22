/**
 * MCP 사용자 격리 + 카탈로그 + 인스턴스 lifecycle Repository.
 *
 * 핵심 동작:
 *   - listCatalog(tier): 사용자 tier 이하 템플릿만 반환
 *   - createFromCatalog: 카탈로그 템플릿 + 사용자 입력 args/env → mcp_servers INSERT
 *     - args_schema 의 properties 기반 render → mcp_servers.args (JSONB)
 *     - env_schema 의 secret=true 필드는 token-crypto AES-256-GCM 암호화 (v1:...)
 *     - url_template 의 {key} → 사용자 args 로 substitute
 *   - listUserServers: 본인 + global visibility 서버 반환 (env 는 응답 시 *** 마스킹)
 *   - recordInstanceTransition: lifecycle-supervisor (Phase 7) 가 호출
 *
 * 참조: docs/superpowers/plans/2026-05-20-phase6-mcp-user-isolation.md §5.2.2
 */
import type { Pool } from 'pg';
import { encryptToken, decryptToken } from '../../utils/token-crypto';
import { createLogger } from '../../utils/logger';
import type {
    McpCatalogTemplate,
    McpFromCatalogPayload,
    McpVisibility,
    McpInstance,
    McpInstanceStatus,
} from '../../schemas/mcp-catalog.schema';

const logger = createLogger('McpCatalogRepository');

export interface UserMcpServerRow {
    id: string;
    user_id: string | null;
    name: string;
    transport_type: 'stdio' | 'sse' | 'streamable-http';
    command: string | null;
    args: unknown[] | null;
    env: Record<string, string> | null;
    url: string | null;
    visibility: McpVisibility;
    catalog_template_id: string | null;
    auto_spawn: boolean;
    enabled: boolean;
    created_at: string;
    updated_at: string;
}

export class McpCatalogRepository {
    constructor(private pool: Pool) {}

    async listCatalog(userTier: string): Promise<McpCatalogTemplate[]> {
        const tierOrder = ['free', 'starter', 'standard', 'pro', 'enterprise'];
        const maxIdx = tierOrder.indexOf(userTier);
        const allowedTiers = maxIdx < 0 ? ['free'] : tierOrder.slice(0, maxIdx + 1);
        const result = await this.pool.query<McpCatalogTemplate>(
            `SELECT id, display_name, description, transport_type, command_template,
                    args_schema, env_schema, url_template, required_tier, is_enabled
             FROM mcp_server_catalog
             WHERE is_enabled = TRUE AND required_tier = ANY($1)
             ORDER BY required_tier, display_name`,
            [allowedTiers],
        );
        return result.rows;
    }

    async getCatalogTemplate(id: string): Promise<McpCatalogTemplate | null> {
        const result = await this.pool.query<McpCatalogTemplate>(
            `SELECT id, display_name, description, transport_type, command_template,
                    args_schema, env_schema, url_template, required_tier, is_enabled
             FROM mcp_server_catalog
             WHERE id = $1 AND is_enabled = TRUE`,
            [id],
        );
        return result.rows[0] ?? null;
    }

    // ────────────────────────────────────────────────────────────
    // Admin CRUD (Phase 4.6) — is_enabled=FALSE 도 조회 가능
    // ────────────────────────────────────────────────────────────

    /** admin 전용 — disabled 포함 전체 catalog */
    async listAllForAdmin(): Promise<McpCatalogTemplate[]> {
        const result = await this.pool.query<McpCatalogTemplate>(
            `SELECT id, display_name, description, transport_type, command_template,
                    args_schema, env_schema, url_template, required_tier, is_enabled
             FROM mcp_server_catalog
             ORDER BY is_enabled DESC, required_tier, id`,
        );
        return result.rows;
    }

    /** admin 전용 — disabled 포함 단건 */
    async getCatalogTemplateForAdmin(id: string): Promise<McpCatalogTemplate | null> {
        const result = await this.pool.query<McpCatalogTemplate>(
            `SELECT id, display_name, description, transport_type, command_template,
                    args_schema, env_schema, url_template, required_tier, is_enabled
             FROM mcp_server_catalog
             WHERE id = $1`,
            [id],
        );
        return result.rows[0] ?? null;
    }

    async insertCatalogTemplate(input: {
        id: string;
        display_name: string;
        description?: string | null;
        transport_type: 'stdio' | 'sse' | 'streamable-http';
        command_template?: string | null;
        args_schema?: Record<string, unknown>;
        env_schema?: Record<string, unknown>;
        url_template?: string | null;
        required_tier: 'free' | 'starter' | 'standard' | 'pro' | 'enterprise';
        is_enabled?: boolean;
    }): Promise<McpCatalogTemplate> {
        const result = await this.pool.query<McpCatalogTemplate>(
            `INSERT INTO mcp_server_catalog (
                id, display_name, description, transport_type, command_template,
                args_schema, env_schema, url_template, required_tier, is_enabled
             ) VALUES (
                $1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8, $9, $10
             ) RETURNING id, display_name, description, transport_type, command_template,
                        args_schema, env_schema, url_template, required_tier, is_enabled`,
            [
                input.id,
                input.display_name,
                input.description ?? null,
                input.transport_type,
                input.command_template ?? null,
                JSON.stringify(input.args_schema ?? {}),
                JSON.stringify(input.env_schema ?? {}),
                input.url_template ?? null,
                input.required_tier,
                input.is_enabled ?? true,
            ],
        );
        return result.rows[0];
    }

    async updateCatalogTemplate(
        id: string,
        patch: Partial<{
            display_name: string;
            description: string | null;
            transport_type: 'stdio' | 'sse' | 'streamable-http';
            command_template: string | null;
            args_schema: Record<string, unknown>;
            env_schema: Record<string, unknown>;
            url_template: string | null;
            required_tier: 'free' | 'starter' | 'standard' | 'pro' | 'enterprise';
            is_enabled: boolean;
        }>,
    ): Promise<McpCatalogTemplate | null> {
        const sets: string[] = [];
        const params: unknown[] = [];
        let idx = 1;
        const push = (col: string, val: unknown, cast?: string) => {
            sets.push(`${col} = $${idx}${cast ?? ''}`);
            params.push(val);
            idx++;
        };
        if (patch.display_name !== undefined) push('display_name', patch.display_name);
        if (patch.description !== undefined) push('description', patch.description);
        if (patch.transport_type !== undefined) push('transport_type', patch.transport_type);
        if (patch.command_template !== undefined) push('command_template', patch.command_template);
        if (patch.args_schema !== undefined) push('args_schema', JSON.stringify(patch.args_schema), '::jsonb');
        if (patch.env_schema !== undefined) push('env_schema', JSON.stringify(patch.env_schema), '::jsonb');
        if (patch.url_template !== undefined) push('url_template', patch.url_template);
        if (patch.required_tier !== undefined) push('required_tier', patch.required_tier);
        if (patch.is_enabled !== undefined) push('is_enabled', patch.is_enabled);
        if (sets.length === 0) {
            return this.getCatalogTemplateForAdmin(id);
        }
        params.push(id);
        const result = await this.pool.query<McpCatalogTemplate>(
            `UPDATE mcp_server_catalog
                SET ${sets.join(', ')}
              WHERE id = $${idx}
              RETURNING id, display_name, description, transport_type, command_template,
                        args_schema, env_schema, url_template, required_tier, is_enabled`,
            params,
        );
        return result.rows[0] ?? null;
    }

    async deleteCatalogTemplate(id: string): Promise<boolean> {
        const result = await this.pool.query(
            `DELETE FROM mcp_server_catalog WHERE id = $1`,
            [id],
        );
        return (result.rowCount ?? 0) > 0;
    }

    async listUserServers(userId: string): Promise<UserMcpServerRow[]> {
        const result = await this.pool.query<UserMcpServerRow>(
            `SELECT id, user_id, name, transport_type, command, args, env, url,
                    visibility, catalog_template_id, auto_spawn, enabled,
                    created_at::text, updated_at::text
             FROM mcp_servers
             WHERE user_id = $1 OR visibility = 'global'
             ORDER BY (user_id IS NULL) ASC, created_at DESC`,
            [userId],
        );
        return result.rows.map(this.maskEnv);
    }

    async createFromCatalog(
        payload: McpFromCatalogPayload,
        template: McpCatalogTemplate,
        userId: string,
    ): Promise<UserMcpServerRow> {
        const id = `mcp_${userId}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const args = this.renderArgs(template, payload.args);
        const env = this.encryptEnv(template, payload.env);
        const url = this.renderUrl(template, payload.args);

        const result = await this.pool.query<UserMcpServerRow>(
            `INSERT INTO mcp_servers
             (id, user_id, name, transport_type, command, args, env, url,
              visibility, catalog_template_id, auto_spawn, enabled, created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8, $9, $10, $11, TRUE, NOW(), NOW())
             RETURNING id, user_id, name, transport_type, command, args, env, url,
                       visibility, catalog_template_id, auto_spawn, enabled,
                       created_at::text, updated_at::text`,
            [
                id,
                userId,
                payload.name,
                template.transport_type,
                template.command_template ?? null,
                JSON.stringify(args),
                JSON.stringify(env),
                url,
                payload.visibility,
                template.id,
                payload.auto_spawn,
            ],
        );
        logger.info(`사용자 MCP 서버 등록: ${id} (template=${template.id}, user=${userId})`);
        return this.maskEnv(result.rows[0]!);
    }

    async deleteUserServer(serverId: string, userId: string, isAdmin: boolean): Promise<boolean> {
        const where = isAdmin ? 'id = $1' : 'id = $1 AND user_id = $2';
        const params = isAdmin ? [serverId] : [serverId, userId];
        const result = await this.pool.query(`DELETE FROM mcp_servers WHERE ${where}`, params);
        return (result.rowCount ?? 0) > 0;
    }

    async getServerById(serverId: string): Promise<UserMcpServerRow | null> {
        const result = await this.pool.query<UserMcpServerRow>(
            `SELECT id, user_id, name, transport_type, command, args, env, url,
                    visibility, catalog_template_id, auto_spawn, enabled,
                    created_at::text, updated_at::text
             FROM mcp_servers WHERE id = $1`,
            [serverId],
        );
        return result.rows[0] ? this.maskEnv(result.rows[0]) : null;
    }

    async listInstances(userId: string): Promise<McpInstance[]> {
        const result = await this.pool.query<McpInstance>(
            `SELECT id, mcp_server_id, user_id, pid, status,
                    started_at::text, stopped_at::text, last_error
             FROM mcp_server_instances
             WHERE user_id = $1
             ORDER BY started_at DESC
             LIMIT 100`,
            [userId],
        );
        return result.rows;
    }

    // ────────────────────────────────────────────────────────────
    // Phase 5: instance metrics (read-only aggregation)
    // ────────────────────────────────────────────────────────────

    /**
     * 단일 서버의 lifecycle metrics — 사용자별 격리.
     *
     * - currentRunning: 현재 status='running' 또는 'starting' 인 instance 수
     * - totalSpawned: 누적 transition row 수 (append-only INSERT)
     * - crashed24h: 최근 24h 내 status='crashed' 발생 수
     * - avgUptimeSec: 완료된 instance (stopped + crashed) 의 평균 uptime 초
     * - lastErrorAt / lastErrorMessage: 가장 최근 crashed 의 시각 + 메시지
     */
    async getServerInstanceMetrics(
        serverId: string,
        userId: string,
    ): Promise<{
        currentRunning: number;
        totalSpawned: number;
        crashed24h: number;
        avgUptimeSec: number | null;
        lastErrorAt: string | null;
        lastErrorMessage: string | null;
    }> {
        const r = await this.pool.query<{
            current_running: string;
            total_spawned: string;
            crashed_24h: string;
            avg_uptime_sec: string | null;
            last_error_at: string | null;
            last_error_message: string | null;
        }>(
            `SELECT
                COUNT(*) FILTER (WHERE status IN ('starting','running'))::text AS current_running,
                COUNT(*)::text AS total_spawned,
                COUNT(*) FILTER (WHERE status='crashed' AND started_at > NOW() - INTERVAL '24 hours')::text AS crashed_24h,
                AVG(EXTRACT(EPOCH FROM (stopped_at - started_at)))
                    FILTER (WHERE stopped_at IS NOT NULL)::text AS avg_uptime_sec,
                MAX(started_at) FILTER (WHERE status='crashed')::text AS last_error_at,
                (SELECT last_error FROM mcp_server_instances
                  WHERE mcp_server_id = $1 AND user_id = $2 AND status='crashed'
                  ORDER BY started_at DESC LIMIT 1) AS last_error_message
              FROM mcp_server_instances
              WHERE mcp_server_id = $1 AND user_id = $2`,
            [serverId, userId],
        );
        const row = r.rows[0];
        return {
            currentRunning: parseInt(row?.current_running || '0', 10),
            totalSpawned: parseInt(row?.total_spawned || '0', 10),
            crashed24h: parseInt(row?.crashed_24h || '0', 10),
            avgUptimeSec: row?.avg_uptime_sec ? parseFloat(row.avg_uptime_sec) : null,
            lastErrorAt: row?.last_error_at || null,
            lastErrorMessage: row?.last_error_message || null,
        };
    }

    /**
     * 사용자의 모든 서버 통합 summary.
     */
    async getUserInstancesSummary(userId: string): Promise<{
        totalServers: number;
        currentRunning: number;
        totalSpawned: number;
        crashed24h: number;
    }> {
        const r = await this.pool.query<{
            total_servers: string;
            current_running: string;
            total_spawned: string;
            crashed_24h: string;
        }>(
            `SELECT
                (SELECT COUNT(DISTINCT id)::text FROM mcp_servers WHERE user_id = $1) AS total_servers,
                COUNT(*) FILTER (WHERE status IN ('starting','running'))::text AS current_running,
                COUNT(*)::text AS total_spawned,
                COUNT(*) FILTER (WHERE status='crashed' AND started_at > NOW() - INTERVAL '24 hours')::text AS crashed_24h
              FROM mcp_server_instances
              WHERE user_id = $1`,
            [userId],
        );
        const row = r.rows[0];
        return {
            totalServers: parseInt(row?.total_servers || '0', 10),
            currentRunning: parseInt(row?.current_running || '0', 10),
            totalSpawned: parseInt(row?.total_spawned || '0', 10),
            crashed24h: parseInt(row?.crashed_24h || '0', 10),
        };
    }

    async recordInstanceTransition(
        serverId: string,
        userId: string,
        status: McpInstanceStatus,
        pid?: number,
        lastError?: string,
    ): Promise<void> {
        await this.pool.query(
            `INSERT INTO mcp_server_instances (mcp_server_id, user_id, pid, status, started_at, stopped_at, last_error)
             VALUES ($1, $2, $3, $4, NOW(), $5, $6)`,
            [
                serverId,
                userId,
                pid ?? null,
                status,
                status === 'stopped' || status === 'crashed' ? new Date().toISOString() : null,
                lastError ?? null,
            ],
        );
    }

    /**
     * spawn 시점에 child process env 로 전달할 평문 env 복호화.
     * 응답 마스킹 (maskEnv) 과 분리 — 본 메서드는 lifecycle-supervisor (Phase 7) 가 호출.
     */
    async decryptEnvForSpawn(serverId: string): Promise<Record<string, string>> {
        const result = await this.pool.query<{ env: Record<string, string> | null }>(
            `SELECT env FROM mcp_servers WHERE id = $1`,
            [serverId],
        );
        const env = result.rows[0]?.env;
        if (!env) return {};
        const decrypted: Record<string, string> = {};
        for (const [k, v] of Object.entries(env)) {
            if (typeof v === 'string' && v.startsWith('v1:')) {
                decrypted[k] = decryptToken(v);
            } else if (typeof v === 'string') {
                decrypted[k] = v;
            }
        }
        return decrypted;
    }

    private renderArgs(template: McpCatalogTemplate, args: Record<string, unknown>): unknown[] {
        if (template.transport_type !== 'stdio') return [];
        const baseArgs = (template.command_template ?? '').split(/\s+/).slice(1).filter(Boolean);
        const userArgs = Object.entries(args).map(([k, v]) => `--${k}=${String(v)}`);
        return [...baseArgs, ...userArgs];
    }

    private renderUrl(template: McpCatalogTemplate, args: Record<string, unknown>): string | null {
        if (template.transport_type === 'stdio') return null;
        let url = template.url_template ?? '';
        for (const [k, v] of Object.entries(args)) {
            url = url.replace(`{${k}}`, encodeURIComponent(String(v)));
        }
        return url || null;
    }

    private encryptEnv(template: McpCatalogTemplate, env: Record<string, string>): Record<string, string> {
        const envSchema = template.env_schema as { properties?: Record<string, { secret?: boolean }> };
        const encrypted: Record<string, string> = {};
        for (const [k, v] of Object.entries(env)) {
            const isSecret = envSchema.properties?.[k]?.secret === true;
            encrypted[k] = isSecret ? encryptToken(v) : v;
        }
        return encrypted;
    }

    private maskEnv = (row: UserMcpServerRow): UserMcpServerRow => {
        if (!row.env) return row;
        const masked: Record<string, string> = {};
        for (const [k, v] of Object.entries(row.env)) {
            masked[k] = typeof v === 'string' && v.startsWith('v1:') ? '***' : v;
        }
        return { ...row, env: masked };
    };
}
