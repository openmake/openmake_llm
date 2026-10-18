/**
 * MCP 서버 구성요소 저장 — Base 확장 플랫폼(확장 설치·수명주기·권한·마켓 게시·팩 카탈로그 설치)이 쓰는 MCP 테이블 연산
 * (계약 `runtime-ports/component-stores.ts` `McpServerComponentStore`, 2026-10-18).
 *
 * SQL 은 종전 Base 의 자리(agents/git-ingest/extension-components.ts, data/repositories/{user-extension-repository,
 * user-extension-permission-repository,marketplace-export-repository,addon-install-repository}.ts)에서 그대로 옮겼다.
 * 호출자가 넘긴 DB 연결(풀·트랜잭션 클라이언트)로 나가고, 종전에 `BaseRepository` 를 거치던 연산은 같은 재시도 래퍼를 쓴다.
 * 데이터 모듈(`data-module.ts`)에 실려 꺼진 add-on 도 호스트가 불러온다 — 런타임에 기대지 말 것.
 *
 * @module addons/mcp-runtime/data/mcp-server-component-store
 */
import type { Pool } from 'pg';
import type { ExportMcpServer, McpServerComponentStore, StoreDb } from '../../../runtime-ports/component-stores';
import { withRetry } from '../../../runtime-ports/db-access';
import { McpServerDraftRepository } from './mcp-server-draft-repository';

const EXPORT_COLUMNS = `id, name, transport_type, command, args, url,
                    COALESCE((SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(COALESCE(env, '{}'::jsonb)) k), '{}') AS env_keys`;

export function mcpServerComponentStore(db: StoreDb): McpServerComponentStore {
    /** 종전 BaseRepository.query 와 같은 재시도 래퍼 */
    const retried = <T extends Record<string, unknown> = Record<string, unknown>>(sql: string, params: unknown[]) =>
        withRetry(() => db.query<T>(sql, params), { operation: sql.substring(0, 50) });

    return {
        async insertDraft(input) {
            const row = await new McpServerDraftRepository(db as unknown as Pool).insertDraft(input);
            return { id: row.id };
        },

        async findIdByUserAndName(userId, name) {
            const r = await db.query<{ id: string }>(`SELECT id FROM mcp_servers WHERE user_id=$1 AND name=$2 LIMIT 1`, [userId, name]);
            return r.rows[0]?.id ?? null;
        },

        async restrictNetworkForExtension(extensionId) {
            const sandboxed = await retried(
                `UPDATE mcp_servers
                SET sandbox_network = 'none',
                    manifest_meta = COALESCE(manifest_meta, '{}'::jsonb) || jsonb_build_object('networkRestrictedByPermission', true),
                    updated_at = NOW()
              WHERE extension_id = $1
                AND transport_type = 'stdio'
                AND sandbox_network IS DISTINCT FROM 'none'`,
                [extensionId],
            );
            const disabled = await retried(
                `UPDATE mcp_servers
                SET enabled = FALSE,
                    manifest_meta = COALESCE(manifest_meta, '{}'::jsonb) || jsonb_build_object('disabledByPermission', true),
                    updated_at = NOW()
              WHERE extension_id = $1
                AND transport_type <> 'stdio'
                AND enabled = TRUE`,
                [extensionId],
            );
            return { sandboxed: sandboxed.rowCount ?? 0, disabled: disabled.rowCount ?? 0 };
        },

        async restoreNetworkForExtension(extensionId) {
            const r = await retried(
                `UPDATE mcp_servers
                SET sandbox_network = 'full',
                    manifest_meta = manifest_meta - 'networkRestrictedByPermission',
                    updated_at = NOW()
              WHERE extension_id = $1
                AND transport_type = 'stdio'
                AND sandbox_network = 'none'
                AND manifest_meta->>'networkRestrictedByPermission' = 'true'`,
                [extensionId],
            );
            return r.rowCount ?? 0;
        },

        async link(extensionId, ids) {
            for (const serverId of ids) {
                await retried(`UPDATE mcp_servers SET extension_id=$1, updated_at=NOW() WHERE id=$2`, [extensionId, serverId]);
            }
        },

        async listLinked(extensionId) {
            const r = await retried<{ id: string; name: string; status: string; enabled: boolean }>(
                `SELECT id, name, status, enabled FROM mcp_servers WHERE extension_id=$1 ORDER BY name`,
                [extensionId],
            );
            return r.rows;
        },

        async archiveLinked(extensionId, { unlink }) {
            await retried(
                unlink
                    ? `UPDATE mcp_servers SET status='archived', enabled=FALSE, extension_id=NULL, updated_at=NOW() WHERE extension_id=$1`
                    : `UPDATE mcp_servers SET status='archived', enabled=FALSE, updated_at=NOW() WHERE extension_id=$1`,
                [extensionId],
            );
        },

        async listExportCandidates(userId) {
            const r = await db.query<ExportMcpServer>(
                `SELECT ${EXPORT_COLUMNS}
                   FROM mcp_servers
                  WHERE user_id = $1 AND status IS DISTINCT FROM 'draft' AND extension_id IS NULL ORDER BY name`, [userId]);
            return r.rows;
        },

        async getForExport(userId, ids) {
            if (ids.length === 0) return [];
            const r = await db.query<ExportMcpServer>(
                `SELECT ${EXPORT_COLUMNS}
               FROM mcp_servers
              WHERE user_id = $1 AND id = ANY($2::text[]) AND status IS DISTINCT FROM 'draft' AND extension_id IS NULL`, [userId, [...ids]]);
            return r.rows;
        },

        async installCatalogTemplate(template) {
            await db.query(
                `INSERT INTO mcp_server_catalog
                   (id, display_name, description, transport_type, command_template, url_template,
                    args_schema, env_schema, tool_allowlist, is_enabled)
                 VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9::jsonb, $10)
                 ON CONFLICT (id) DO NOTHING`,
                [
                    template.id, template.displayName, template.description, template.transportType,
                    template.commandTemplate ?? null, template.urlTemplate ?? null,
                    JSON.stringify(template.argsSchema), JSON.stringify(template.envSchema),
                    template.toolAllowlist ? JSON.stringify(template.toolAllowlist) : null,
                    template.defaultEnabled,
                ],
            );
        },
    };
}
