/**
 * MCP catalog admin CRUD repository (Phase 4.6).
 *
 * mcp-catalog-repository.ts 에서 추출 (max-lines 정책 + 책임 분리).
 * 운영자가 mcp_server_catalog 의 row 를 추가/수정/삭제하는 admin 콘솔 전용.
 *
 * 사용자용 (is_enabled=TRUE 필터) listCatalog / getCatalogTemplate 은
 * McpCatalogRepository 에 그대로 유지 — admin 메서드는 disabled 포함.
 *
 * @module data/repositories/mcp-catalog-admin-repository
 */
import type { Pool } from 'pg';
import type { McpCatalogTemplate } from '../../schemas/mcp-catalog.schema';

type TransportType = 'stdio' | 'sse' | 'streamable-http';
type Tier = 'free' | 'starter' | 'standard' | 'pro' | 'enterprise';

export interface InsertCatalogTemplateInput {
    id: string;
    display_name: string;
    description?: string | null;
    transport_type: TransportType;
    command_template?: string | null;
    args_schema?: Record<string, unknown>;
    env_schema?: Record<string, unknown>;
    url_template?: string | null;
    required_tier: Tier;
    is_enabled?: boolean;
}

export type UpdateCatalogTemplatePatch = Partial<{
    display_name: string;
    description: string | null;
    transport_type: TransportType;
    command_template: string | null;
    args_schema: Record<string, unknown>;
    env_schema: Record<string, unknown>;
    url_template: string | null;
    required_tier: Tier;
    is_enabled: boolean;
}>;

export class McpCatalogAdminRepository {
    constructor(private pool: Pool) {}

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

    async insertCatalogTemplate(input: InsertCatalogTemplateInput): Promise<McpCatalogTemplate> {
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
        patch: UpdateCatalogTemplatePatch,
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
}
