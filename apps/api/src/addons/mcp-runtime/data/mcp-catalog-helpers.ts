/**
 * McpCatalogRepository 의 행 타입·순수 헬퍼 (args/url 렌더, env 기본값·암호화·마스킹, pid 생존 확인)
 * 와 instance metrics 집계 SQL.
 * mcp-catalog-repository.ts 에서 분리 — 동작은 그대로.
 */
import { McpCatalogInputError } from './mcp-catalog-input';
import { encryptToken } from '../../../utils/token-crypto';
import type { McpCatalogTemplate, McpVisibility } from '../schemas/mcp-catalog.schema';

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

const MAX_CATALOG_ARG_VALUE_LENGTH = 512;

/**
 * 카탈로그 인자 값 검증(E5) — `--key=value` 의 value 에 옵션 모양·공백·제어문자를 싣지 못하게 한다.
 * 문자열·숫자·불리언만 받고, 렌더한 문자열(String(v))이 512자 이하·공백/제어문자 없음·`-` 로 시작하지 않아야 한다.
 * 값은 메시지에 넣지 않는다. 키 검증(args_schema.properties)은 validateCatalogInput 이 맡는다.
 * @throws {McpCatalogInputError} 라우트 400
 */
export function assertCatalogArgValue(key: string, v: unknown): string {
    if (typeof v !== 'string' && typeof v !== 'number' && typeof v !== 'boolean') {
        throw new McpCatalogInputError(`잘못된 인자 값: ${key}`);
    }
    const s = String(v);
    if (s.length > MAX_CATALOG_ARG_VALUE_LENGTH || /[\s\x00-\x1f]/.test(s) || s.startsWith('-')) {
        throw new McpCatalogInputError(`잘못된 인자 값: ${key}`);
    }
    return s;
}

export function renderArgs(template: McpCatalogTemplate, args: Record<string, unknown>): unknown[] {
    if (template.transport_type !== 'stdio') return [];
    const baseArgs = (template.command_template ?? '').split(/\s+/).slice(1).filter(Boolean);
    const userArgs = Object.entries(args).map(([k, v]) => `--${k}=${assertCatalogArgValue(k, v)}`);
    return [...baseArgs, ...userArgs];
}

export function renderUrl(template: McpCatalogTemplate, args: Record<string, unknown>): string | null {
    if (template.transport_type === 'stdio') return null;
    let url = template.url_template ?? '';
    for (const [k, v] of Object.entries(args)) {
        url = url.replace(`{${k}}`, encodeURIComponent(String(v)));
    }
    return url || null;
}

/**
 * env_schema properties 의 `default` 를 미입력 키에 채운다 (설치 시 1회, 값은 평문 그대로).
 * 설치 폼은 `required` 키만 입력받으므로, 서버가 동작하는 데 필요하지만 사용자가 알 필요 없는
 * 고정 env(예: readonly 샌드박스에서 SQLite 캐시 경로를 캐시 볼륨으로 돌리는 HOME)를 카탈로그가
 * 선언할 수 있다. 사용자가 명시한 값이 우선한다.
 */
export function applyEnvDefaults(template: McpCatalogTemplate, env: Record<string, string>): Record<string, string> {
    const props = (template.env_schema as { properties?: Record<string, { default?: unknown }> }).properties ?? {};
    const merged: Record<string, string> = { ...env };
    for (const [k, p] of Object.entries(props)) {
        if (merged[k] === undefined && typeof p?.default === 'string') merged[k] = p.default;
    }
    return merged;
}

export function encryptEnv(template: McpCatalogTemplate, env: Record<string, string>): Record<string, string> {
    const envSchema = template.env_schema as { properties?: Record<string, { secret?: boolean }> };
    const encrypted: Record<string, string> = {};
    for (const [k, v] of Object.entries(env)) {
        const isSecret = envSchema.properties?.[k]?.secret === true;
        encrypted[k] = isSecret ? encryptToken(v) : v;
    }
    return encrypted;
}

export function maskEnv(row: UserMcpServerRow): UserMcpServerRow {
    if (!row.env) return row;
    const masked: Record<string, string> = {};
    for (const [k, v] of Object.entries(row.env)) {
        masked[k] = typeof v === 'string' && v.startsWith('v1:') ? '***' : v;
    }
    return { ...row, env: masked };
}

/**
 * signal 0 — non-disruptive aliveness probe.
 * ESRCH (no such process) → dead. EPERM → alive (외부 권한).
 * (verifyRunningInstancesByPid 에서 분리)
 */
export function isPidAlive(pid: number): boolean {
    let alive = false;
    try {
        process.kill(pid, 0);
        alive = true;
    } catch (e) {
        const code = (e as NodeJS.ErrnoException).code;
        if (code === 'EPERM') alive = true; // 외부 권한 — 보수적으로 alive
        else alive = false;
    }
    return alive;
}

/** getServerInstanceMetrics 집계 SQL — $1=serverId, $2=userId (사용자별 격리) */
export const SERVER_INSTANCE_METRICS_SQL = `SELECT
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
      WHERE mcp_server_id = $1 AND user_id = $2`;

/** getUserInstancesSummary 집계 SQL — $1=userId */
export const USER_INSTANCES_SUMMARY_SQL = `SELECT
        (SELECT COUNT(DISTINCT id)::text FROM mcp_servers WHERE user_id = $1) AS total_servers,
        COUNT(*) FILTER (WHERE status IN ('starting','running'))::text AS current_running,
        COUNT(*)::text AS total_spawned,
        COUNT(*) FILTER (WHERE status='crashed' AND started_at > NOW() - INTERVAL '24 hours')::text AS crashed_24h
      FROM mcp_server_instances
      WHERE user_id = $1`;
