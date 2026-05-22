/**
 * MCP admin observability — 전역 aggregate (admin 전용, user_id 격리 없음).
 *
 * Phase 5.3 산출물. mcp-catalog-repository.ts 에서 추출 (max-lines 정책 +
 * 책임 분리). admin 전용 routes 만 사용.
 *
 * 모든 메서드는 read-only — write 없음.
 *
 * @module data/repositories/mcp-admin-monitoring-repository
 */
import type { Pool } from 'pg';

export interface GlobalInstanceSummary {
    totalServers: number;
    totalUsers: number;
    currentRunning: number;
    totalSpawned: number;
    crashed24h: number;
    crashRate24hPct: number | null;
}

export interface TopCrashedServer {
    mcp_server_id: string;
    name: string;
    user_id: string | null;
    visibility: string;
    crash_count: number;
    last_crash_at: string | null;
}

export interface CrashTrendBucket {
    hour: string;
    spawned: number;
    crashed: number;
}

export class McpAdminMonitoringRepository {
    constructor(private pool: Pool) {}

    /**
     * 전체 사용자의 instance summary (admin 전용 — 격리 없음).
     */
    async getGlobalInstanceSummary(): Promise<GlobalInstanceSummary> {
        const r = await this.pool.query<{
            total_servers: string;
            total_users: string;
            current_running: string;
            total_spawned: string;
            crashed_24h: string;
            spawned_24h: string;
        }>(
            `SELECT
                (SELECT COUNT(*)::text FROM mcp_servers) AS total_servers,
                (SELECT COUNT(DISTINCT user_id)::text FROM mcp_server_instances) AS total_users,
                COUNT(*) FILTER (WHERE status IN ('starting','running'))::text AS current_running,
                COUNT(*)::text AS total_spawned,
                COUNT(*) FILTER (WHERE status='crashed' AND started_at > NOW() - INTERVAL '24 hours')::text AS crashed_24h,
                COUNT(*) FILTER (WHERE started_at > NOW() - INTERVAL '24 hours')::text AS spawned_24h
              FROM mcp_server_instances`,
        );
        const row = r.rows[0];
        const spawned24h = parseInt(row?.spawned_24h || '0', 10);
        const crashed24h = parseInt(row?.crashed_24h || '0', 10);
        return {
            totalServers: parseInt(row?.total_servers || '0', 10),
            totalUsers: parseInt(row?.total_users || '0', 10),
            currentRunning: parseInt(row?.current_running || '0', 10),
            totalSpawned: parseInt(row?.total_spawned || '0', 10),
            crashed24h,
            crashRate24hPct: spawned24h > 0 ? (crashed24h / spawned24h) * 100 : null,
        };
    }

    /**
     * Crash count desc 로 N개 server (지난 7일).
     */
    async getTopCrashedServers(limit: number = 10): Promise<TopCrashedServer[]> {
        const r = await this.pool.query<{
            mcp_server_id: string;
            name: string;
            user_id: string | null;
            visibility: string;
            crash_count: string;
            last_crash_at: string | null;
        }>(
            `SELECT i.mcp_server_id,
                    s.name,
                    s.user_id,
                    s.visibility,
                    COUNT(*)::text AS crash_count,
                    MAX(i.started_at)::text AS last_crash_at
               FROM mcp_server_instances i
               JOIN mcp_servers s ON s.id = i.mcp_server_id
              WHERE i.status='crashed'
                AND i.started_at > NOW() - INTERVAL '7 days'
              GROUP BY i.mcp_server_id, s.name, s.user_id, s.visibility
              ORDER BY COUNT(*) DESC
              LIMIT $1`,
            [limit],
        );
        return r.rows.map(row => ({
            mcp_server_id: row.mcp_server_id,
            name: row.name,
            user_id: row.user_id,
            visibility: row.visibility,
            crash_count: parseInt(row.crash_count, 10),
            last_crash_at: row.last_crash_at,
        }));
    }

    /**
     * 24시간 timeline — 각 시간대 spawn / crash 카운트. 빈 슬롯은 0.
     */
    async getCrashTrendByHour(): Promise<CrashTrendBucket[]> {
        const r = await this.pool.query<{
            hour: string;
            spawned: string;
            crashed: string;
        }>(
            `WITH hours AS (
                SELECT generate_series(
                    date_trunc('hour', NOW()) - INTERVAL '23 hours',
                    date_trunc('hour', NOW()),
                    INTERVAL '1 hour'
                ) AS hour
            )
            SELECT h.hour::text AS hour,
                   COUNT(i.id) FILTER (WHERE i.started_at IS NOT NULL)::text AS spawned,
                   COUNT(i.id) FILTER (WHERE i.status='crashed')::text AS crashed
              FROM hours h
              LEFT JOIN mcp_server_instances i
                ON date_trunc('hour', i.started_at) = h.hour
             GROUP BY h.hour
             ORDER BY h.hour ASC`,
        );
        return r.rows.map(row => ({
            hour: row.hour,
            spawned: parseInt(row.spawned, 10),
            crashed: parseInt(row.crashed, 10),
        }));
    }
}
