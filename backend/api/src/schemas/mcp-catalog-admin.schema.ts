/**
 * MCP catalog admin CRUD 입력 스키마 (Phase 4.6).
 *
 * - createCatalogTemplateSchema: POST /api/admin/mcp/catalog
 * - updateCatalogTemplateSchema: PUT  /api/admin/mcp/catalog/:id (모두 optional)
 *
 * id 패턴: 'mcp-' prefix 강제 (기존 catalog 와 일관 + collision 방지).
 *
 * @module schemas/mcp-catalog-admin.schema
 */
import { z } from 'zod';

const TRANSPORT = z.enum(['stdio', 'sse', 'streamable-http']);

// args_schema / env_schema 는 JSON Schema object — 깊은 검증은 admin 의 책임.
// 여기서는 object 인지만 검증.
const JSON_SCHEMA_OBJECT = z.record(z.string(), z.unknown());

export const createCatalogTemplateSchema = z.object({
    id: z.string()
        .min(3)
        .max(100)
        .regex(/^mcp-[a-z0-9][a-z0-9-]*$/, 'id 는 "mcp-" 로 시작하는 소문자/숫자/하이픈만 허용'),
    display_name: z.string().min(1).max(200),
    description: z.string().max(1000).optional().nullable(),
    transport_type: TRANSPORT,
    command_template: z.string().max(2000).optional().nullable(),
    args_schema: JSON_SCHEMA_OBJECT.optional(),
    env_schema: JSON_SCHEMA_OBJECT.optional(),
    url_template: z.string().max(500).optional().nullable(),
    is_enabled: z.boolean().optional(),
}).superRefine((data, ctx) => {
    if (data.transport_type === 'stdio' && !data.command_template) {
        ctx.addIssue({
            code: 'custom',
            message: 'stdio transport 는 command_template 필수',
            path: ['command_template'],
        });
    }
    if ((data.transport_type === 'sse' || data.transport_type === 'streamable-http') && !data.url_template) {
        ctx.addIssue({
            code: 'custom',
            message: `${data.transport_type} transport 는 url_template 필수`,
            path: ['url_template'],
        });
    }
});

export type CreateCatalogTemplateInput = z.infer<typeof createCatalogTemplateSchema>;

export const updateCatalogTemplateSchema = z.object({
    display_name: z.string().min(1).max(200).optional(),
    description: z.string().max(1000).nullable().optional(),
    transport_type: TRANSPORT.optional(),
    command_template: z.string().max(2000).nullable().optional(),
    args_schema: JSON_SCHEMA_OBJECT.optional(),
    env_schema: JSON_SCHEMA_OBJECT.optional(),
    url_template: z.string().max(500).nullable().optional(),
    is_enabled: z.boolean().optional(),
});

export type UpdateCatalogTemplateInput = z.infer<typeof updateCatalogTemplateSchema>;
