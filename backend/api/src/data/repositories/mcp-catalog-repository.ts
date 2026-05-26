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

    /**
     * 여러 catalog template 의 required_tier 만 batch 조회.
     * tool-router 의 tier 게이트가 호출 — chat 흐름마다 N개 fetch 회피.
     */
    async getRequiredTiersByTemplateIds(ids: string[]): Promise<Map<string, string>> {
        if (ids.length === 0) return new Map();
        const result = await this.pool.query<{ id: string; required_tier: string }>(
            `SELECT id, required_tier FROM mcp_server_catalog WHERE id = ANY($1)`,
            [ids],
        );
        const map = new Map<string, string>();
        for (const row of result.rows) map.set(row.id, row.required_tier);
        return map;
    }

    // Admin CRUD (Phase 4.6) 메서드 (listAllForAdmin / getCatalogTemplateForAdmin /
    // insert / update / deleteCatalogTemplate) 는 별도 module 로 분리:
    // → data/repositories/mcp-catalog-admin-repository.ts

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
        // command_template 의 첫 토큰만 command 컬럼에 저장 (예: "npx -y firecrawl-mcp" → "npx").
        // 나머지 토큰은 renderArgs 가 args 로 분리. child_process.spawn 은 command 가 단일 실행파일이어야 함.
        const commandOnly = template.transport_type === 'stdio'
            ? ((template.command_template ?? '').split(/\s+/).filter(Boolean)[0] ?? null)
            : null;

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
                commandOnly,
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

    // Phase 5.3 admin observability 메서드 (getGlobalInstanceSummary /
    // getTopCrashedServers / getCrashTrendByHour) 는 별도 module 로 분리:
    // → data/repositories/mcp-admin-monitoring-repository.ts

    /**
     * Phase 5.2: status='running' 또는 'starting' 인 instance 의 pid 가
     * 실제 alive 한지 process.kill(pid, 0) 으로 검증. 죽었으면 status='crashed'
     * + last_error='process not alive (health check)' UPDATE.
     *
     * pid 가 null 인 row 는 검증 불가 → 그대로 둠 (signal-based 검증 불가).
     *
     * 반환: { verified, declaredDead, missingPid } 카운트.
     */
    async verifyRunningInstancesByPid(
        serverId: string,
        userId: string,
    ): Promise<{ verified: number; declaredDead: number; missingPid: number }> {
        const r = await this.pool.query<{ id: string; pid: number | null }>(
            `SELECT id, pid FROM mcp_server_instances
              WHERE mcp_server_id = $1 AND user_id = $2
                AND status IN ('starting', 'running')`,
            [serverId, userId],
        );
        let verified = 0;
        let declaredDead = 0;
        let missingPid = 0;
        for (const row of r.rows) {
            if (row.pid == null) {
                missingPid++;
                continue;
            }
            let alive = false;
            try {
                // signal 0 — non-disruptive aliveness probe.
                // ESRCH (no such process) → dead. EPERM → alive (외부 권한).
                process.kill(row.pid, 0);
                alive = true;
            } catch (e) {
                const code = (e as NodeJS.ErrnoException).code;
                if (code === 'EPERM') alive = true; // 외부 권한 — 보수적으로 alive
                else alive = false;
            }
            if (alive) {
                verified++;
            } else {
                declaredDead++;
                await this.pool.query(
                    `UPDATE mcp_server_instances
                        SET status = 'crashed',
                            stopped_at = NOW(),
                            last_error = COALESCE(last_error, 'process not alive (health check)')
                      WHERE id = $1`,
                    [row.id],
                );
            }
        }
        return { verified, declaredDead, missingPid };
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
