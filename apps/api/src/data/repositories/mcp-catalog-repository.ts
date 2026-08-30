/**
 * MCP 사용자 격리 + 카탈로그 + 인스턴스 lifecycle Repository.
 *
 * 핵심 동작:
 *   - listCatalog(): 활성화된 전체 템플릿 반환 (제한 없음)
 *   - createFromCatalog: 카탈로그 템플릿 + 사용자 입력 args/env → mcp_servers INSERT
 *     - args_schema 의 properties 기반 render → mcp_servers.args (JSONB)
 *     - env_schema 의 secret=true 필드는 token-crypto AES-256-GCM 암호화 (v1:...)
 *     - url_template 의 {key} → 사용자 args 로 substitute
 *   - listUserServers: 본인 + global visibility 서버 반환 (env 는 응답 시 *** 마스킹)
 *   - recordInstanceTransition: lifecycle-supervisor (Phase 7) 가 호출
 *
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
    /** stdio docker 샌드박스 네트워크 정책 ('full'|'none'). 042 마이그레이션. */
    sandbox_network?: 'full' | 'none' | 'host' | null;
}

export class McpCatalogRepository {
    constructor(private pool: Pool) {}

    async listCatalog(): Promise<McpCatalogTemplate[]> {
        const result = await this.pool.query<McpCatalogTemplate>(
            `SELECT id, display_name, description, transport_type, command_template,
                    args_schema, env_schema, url_template, is_enabled, tool_allowlist
             FROM mcp_server_catalog
             WHERE is_enabled = TRUE
             ORDER BY display_name`,
        );
        return result.rows;
    }

    async getCatalogTemplate(id: string): Promise<McpCatalogTemplate | null> {
        const result = await this.pool.query<McpCatalogTemplate>(
            `SELECT id, display_name, description, transport_type, command_template,
                    args_schema, env_schema, url_template, is_enabled, tool_allowlist
             FROM mcp_server_catalog
             WHERE id = $1 AND is_enabled = TRUE`,
            [id],
        );
        return result.rows[0] ?? null;
    }

    // Admin CRUD (Phase 4.6) 메서드 (listAllForAdmin / getCatalogTemplateForAdmin /
    // insert / update / deleteCatalogTemplate) 는 별도 module 로 분리:
    // → data/repositories/mcp-catalog-admin-repository.ts

    async listUserServers(userId: string): Promise<UserMcpServerRow[]> {
        const result = await this.pool.query<UserMcpServerRow>(
            `SELECT id, user_id, name, transport_type, command, args, env, url,
                    visibility, catalog_template_id, auto_spawn, enabled, sandbox_network,
                    created_at::text, updated_at::text
             FROM mcp_servers
             WHERE user_id = $1 OR visibility = 'global'
             ORDER BY (user_id IS NULL) ASC, created_at DESC`,
            [userId],
        );
        return result.rows.map(this.maskEnv);
    }

    /**
     * spawn 시 채팅 노출 화이트리스트 조회 — is_enabled 무관.
     * getCatalogTemplate(is_enabled=TRUE 필터)을 쓰면 카탈로그 비활성화 시 allowlist 가
     * 사라져 전체 도구가 노출되는 fail-open 역설이 생긴다(비활성화가 제한을 해제).
     * 기존 설치 서버의 노출 제한은 카탈로그 활성 여부와 무관하게 유지돼야 한다.
     */
    async getCatalogToolAllowlist(templateId: string): Promise<string[] | null> {
        const result = await this.pool.query<{ tool_allowlist: string[] | null }>(
            `SELECT tool_allowlist FROM mcp_server_catalog WHERE id = $1`,
            [templateId],
        );
        const list = result.rows[0]?.tool_allowlist;
        return Array.isArray(list) && list.length > 0 ? list : null;
    }

    /** 특정 카탈로그 템플릿으로 설치된 유저 서버 1개 조회 (composer NotebookLM 연동 등) — 최신 설치 우선 */
    async findUserServerByTemplate(userId: string, templateId: string): Promise<{ id: string; name: string } | null> {
        const result = await this.pool.query<{ id: string; name: string }>(
            `SELECT id, name FROM mcp_servers
             WHERE user_id = $1 AND catalog_template_id = $2 AND enabled = TRUE
             ORDER BY created_at DESC
             LIMIT 1`,
            [userId, templateId],
        );
        return result.rows[0] ?? null;
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

    /**
     * 기존 서버의 env 값 교체 (자격증명 로테이션).
     *
     * 부분 갱신 — patch 에 담긴 키만 바꾸고 나머지 기존 값은 보존한다. 새 키 추가는 막는다
     * (허용 키 = 카탈로그 env_schema.properties ∪ 기존 env 키): 임의 키를 넣어 spawn 환경을
     * 오염시키는 경로를 차단하기 위함.
     *
     * secret 판정은 createFromCatalog 의 encryptEnv 와 같은 기준(env_schema.secret)에 더해
     * **기존 값이 이미 암호문(v1:)이면 secret 으로 간주**한다 — 템플릿이 없거나(수동 등록)
     * 스키마가 바뀐 서버에서 암호문이 평문으로 격하되는 것을 막는다.
     *
     * @throws {Error} 허용되지 않은 키가 patch 에 포함된 경우 (라우터가 400 으로 변환)
     */
    /**
     * 서버 이름(=도구 네임스페이스) 변경. 소유자 검증은 라우터 책임.
     * 같은 사용자 안에서 이름은 유일해야 한다(uniq_mcp_servers_user_name) — 충돌은 그대로
     * throw 해 라우터가 409 로 변환한다.
     */
    async updateName(id: string, name: string): Promise<UserMcpServerRow | null> {
        const r = await this.pool.query<UserMcpServerRow>(
            `UPDATE mcp_servers SET name = $2, updated_at = NOW() WHERE id = $1
             RETURNING id, user_id, name, transport_type, command, args, env, url,
                       visibility, catalog_template_id, enabled, auto_spawn, created_at, updated_at`,
            [id, name],
        );
        return r.rows[0] ? this.maskEnv(r.rows[0]) : null;
    }

    async updateEnv(
        serverId: string,
        patch: Record<string, string>,
        template: McpCatalogTemplate | null,
    ): Promise<UserMcpServerRow | null> {
        const current = await this.pool.query<{ env: Record<string, string> | null }>(
            `SELECT env FROM mcp_servers WHERE id = $1`,
            [serverId],
        );
        if (current.rowCount === 0) return null;
        const existing = current.rows[0]?.env ?? {};

        const envSchema = (template?.env_schema ?? {}) as { properties?: Record<string, { secret?: boolean }> };
        const allowed = new Set([...Object.keys(envSchema.properties ?? {}), ...Object.keys(existing)]);
        const rejected = Object.keys(patch).filter((k) => !allowed.has(k));
        if (rejected.length > 0) {
            throw new Error(`허용되지 않은 환경변수 키: ${rejected.join(', ')}`);
        }

        const merged: Record<string, string> = { ...existing };
        for (const [k, v] of Object.entries(patch)) {
            const isSecret = envSchema.properties?.[k]?.secret === true
                || (typeof existing[k] === 'string' && existing[k].startsWith('v1:'));
            merged[k] = isSecret ? encryptToken(v) : v;
        }

        const result = await this.pool.query<UserMcpServerRow>(
            `UPDATE mcp_servers SET env = $2::jsonb, updated_at = NOW()
             WHERE id = $1
             RETURNING id, user_id, name, transport_type, command, args, env, url,
                       visibility, catalog_template_id, auto_spawn, enabled, sandbox_network,
                       created_at::text, updated_at::text`,
            [serverId, JSON.stringify(merged)],
        );
        return result.rows[0] ? this.maskEnv(result.rows[0]) : null;
    }

    async getServerById(serverId: string): Promise<UserMcpServerRow | null> {
        const result = await this.pool.query<UserMcpServerRow>(
            `SELECT id, user_id, name, transport_type, command, args, env, url,
                    visibility, catalog_template_id, auto_spawn, enabled, sandbox_network,
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
                (CASE WHEN (
                    SELECT status FROM mcp_server_instances
                    WHERE mcp_server_id = $1 AND user_id = $2
                    ORDER BY started_at DESC LIMIT 1
                ) = 'running' THEN 1 ELSE 0 END)::text AS current_running,
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

    /**
     * 서버별 **최근 실패 원인**을 한 번에 조회 (목록 API 용).
     *
     * 연결에 실패한 client 는 풀에 남지 않으므로 메모리 상태만으로는 원인을 알 수 없다.
     * `mcp_server_instances` 는 이력 테이블이라 서버당 행이 여러 개 — `DISTINCT ON` 으로
     * 서버별 최신 crashed 행 하나만 뽑는다.
     *
     * ⚠️ 최신 행이 `running` 이면(= 그 뒤 성공적으로 떴다면) 낡은 실패를 보여주지 않도록
     *    제외한다. 안 그러면 지금 잘 도는 서버에 예전 에러가 계속 붙는다.
     */
    /** 서버 사용 여부 토글 — 설정을 보존한 채 목록에서 치우는 용도(삭제의 되돌릴 수 있는 대안). */
    async setServerEnabled(serverId: string, enabled: boolean): Promise<void> {
        await this.pool.query(
            `UPDATE mcp_servers SET enabled = $2, updated_at = NOW() WHERE id = $1`,
            [serverId, enabled],
        );
    }

    /** 자동 연결 토글 — TRUE 면 로그인/채팅 시작/재시작 복구 때 supervisor 가 spawn 한다. */
    async setServerAutoSpawn(serverId: string, autoSpawn: boolean): Promise<void> {
        await this.pool.query(`UPDATE mcp_servers SET auto_spawn = $2, updated_at = NOW() WHERE id = $1`, [serverId, autoSpawn]);
    }

    async getLatestConnectErrors(
        userId: string,
        serverIds: string[],
    ): Promise<Map<string, { message: string; at: string }>> {
        const out = new Map<string, { message: string; at: string }>();
        if (serverIds.length === 0) return out;
        const r = await this.pool.query<{ mcp_server_id: string; status: string; last_error: string | null; started_at: string }>(
            `SELECT DISTINCT ON (mcp_server_id) mcp_server_id, status, last_error, started_at::text
               FROM mcp_server_instances
              WHERE user_id = $1 AND mcp_server_id = ANY($2::text[])
              ORDER BY mcp_server_id, started_at DESC`,
            [userId, serverIds],
        );
        for (const row of r.rows) {
            if (row.status !== 'crashed' || !row.last_error) continue;
            out.set(row.mcp_server_id, { message: row.last_error, at: row.started_at });
        }
        return out;
    }

    /**
     * 프로세스 재시작 후 풀이 비어 있으므로, 이 사용자들의 서버를 다시 띄운다.
     */
    async listAutoSpawnUserIds(): Promise<string[]> {
        const r = await this.pool.query<{ user_id: string }>(
            `SELECT DISTINCT user_id FROM mcp_servers
              WHERE user_id IS NOT NULL AND enabled = TRUE AND auto_spawn = TRUE`,
        );
        return r.rows.map(x => x.user_id);
    }

    /**
     * 고아 instance 행 정리 — 프로세스가 죽으면 running/starting 행이 그대로 남는다
     * (shutdownAll 은 풀만 닫고 전이를 기록하지 않으며, 강제 종료 시엔 그마저 못 남긴다).
     * 부팅 시 1회 호출해 "직전 프로세스의 살아있던 인스턴스"를 stopped 로 마감한다.
     * @returns 마감한 행 수
     */
    async closeOrphanInstances(): Promise<number> {
        const r = await this.pool.query(
            `UPDATE mcp_server_instances
                SET status = 'stopped', stopped_at = NOW(),
                    last_error = COALESCE(last_error, 'process restart')
              WHERE status IN ('running', 'starting')`,
        );
        return r.rowCount ?? 0;
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
     *
     * ⚠️ decryptToken 은 fail-open 이다 — 키 부재나 포맷 오류 시 예외 대신 **암호문을
     * 그대로 반환**한다(token-crypto.ts). 그대로 넘기면 암호문이 자식 프로세스 env 에
     * 주입돼, 서버는 뜨고 도구 목록도 등록되지만 실제 API 호출만 인증 실패하는 형태로
     * 조용히 깨진다(진단이 어려운 실패 모드). 복호화 후에도 v1: 이 남아 있으면 실패로
     * 보고 throw 한다(fail-closed) — safeSpawn 호출자가 서버 단위로 처리한다.
     *
     * @throws {Error} 복호화 실패 시 (TOKEN_ENCRYPTION_KEY 부재/불일치, 저장값 손상)
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
            if (typeof v !== 'string') continue;
            if (!v.startsWith('v1:')) {
                decrypted[k] = v;
                continue;
            }
            const plain = decryptToken(v);
            if (plain.startsWith('v1:')) {
                throw new Error(`env "${k}" 복호화 실패 — 암호문이 그대로 남았습니다 (TOKEN_ENCRYPTION_KEY 설정 및 저장값 포맷을 확인하세요)`);
            }
            decrypted[k] = plain;
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
