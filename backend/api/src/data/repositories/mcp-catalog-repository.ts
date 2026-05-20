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
