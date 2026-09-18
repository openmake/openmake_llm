/**
 * Add-on 설치 이력 (마이그레이션 163) — 내장 add-on 이 싣는 항목을 "한 번만" 설치한다.
 *
 * 이력에 없는 항목만 넣는다 — 관리자가 지운 카탈로그 템플릿을 다음 부팅이 되살리지 않게 하기 위함이다.
 * 이미 있는 행(관리자 수정 포함)은 덮어쓰지 않는다(구 카탈로그 시드 마이그레이션과 같은 규칙).
 *
 * @module data/repositories/addon-install-repository
 */
import type { Pool } from 'pg';

export interface CatalogTemplateInstall {
    id: string;
    displayName: string;
    description: string;
    transportType: 'stdio' | 'streamable-http';
    commandTemplate?: string;
    urlTemplate?: string;
    argsSchema: Record<string, unknown>;
    envSchema: Record<string, unknown>;
    toolAllowlist?: string[];
    defaultEnabled: boolean;
}

export class AddonInstallRepository {
    constructor(private pool: Pool) {}

    /** @returns 이번에 새로 설치했으면 true, 이미 설치 이력이 있으면 false */
    async installCatalogTemplateOnce(addonId: string, template: CatalogTemplateInstall): Promise<boolean> {
        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');
            const claimed = await client.query(
                `INSERT INTO addon_installed_items (kind, item_id, addon_id) VALUES ('mcp-catalog', $1, $2)
                 ON CONFLICT (kind, item_id) DO NOTHING RETURNING item_id`,
                [template.id, addonId],
            );
            if ((claimed.rowCount ?? 0) === 0) {
                await client.query('ROLLBACK');
                return false;
            }
            await client.query(
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
            await client.query('COMMIT');
            return true;
        } catch (err) {
            await client.query('ROLLBACK').catch(() => undefined);
            throw err;
        } finally {
            client.release();
        }
    }
}
