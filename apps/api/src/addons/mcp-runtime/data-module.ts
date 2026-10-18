/**
 * MCP add-on 의 데이터 의무 — 꺼져 있어도 호스트가 불러온다(addon-host/data-data.ts). 런타임 없이 SQL 만 쓴다.
 * 종전 Base 보존 작업(data/db-retention.ts)에 있던 MCP 인스턴스 이력 정리와, Base 확장 플랫폼이 쓰는 MCP 서버 구성요소
 * 저장 연산(stores.mcpServers)을 싣는다(2026-10-18).
 *
 * @module addons/mcp-runtime/data-module
 */
import type { AddonDataModule } from '../../runtime-ports/addon-data';
import { getPool } from '../../runtime-ports/db-access';
import { mcpServerComponentStore } from './data/mcp-server-component-store';

/**
 * mcp_server_instances 전이 이력 정리 — append-only 이력(매 lifecycle 전이마다 INSERT)이 무한 증가하는 것을 막는다.
 * 각 (mcp_server_id, user_id) 의 최신 transition 은 보존해 current_running 계산(최신 transition 기준, PR #127)을 지킨다.
 * MCP_INSTANCE_RETENTION_DAYS(기본 30일), 0 이하·숫자 아님이면 정리하지 않는다.
 */
async function trimInstanceHistory(): Promise<number> {
    const days = parseInt(process.env.MCP_INSTANCE_RETENTION_DAYS ?? '30', 10);
    if (!Number.isFinite(days) || days <= 0) return 0;
    const r = await getPool().query(
        `DELETE FROM mcp_server_instances
         WHERE started_at < NOW() - ($1 || ' days')::interval
           AND id NOT IN (
               SELECT DISTINCT ON (mcp_server_id, user_id) id
               FROM mcp_server_instances
               ORDER BY mcp_server_id, user_id, started_at DESC
           )`,
        [days.toString()],
    );
    return r.rowCount ?? 0;
}

export const mcpDataModule: AddonDataModule = {
    retention: [{ name: 'MCP 인스턴스 이력(최신 transition 보존)', run: trimInstanceHistory }],
    stores: { mcpServers: mcpServerComponentStore },
};
