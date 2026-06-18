/**
 * MCP 카탈로그 / from-catalog / instance Zod 스키마.
 *
 */
import { z } from 'zod';

export const McpVisibilitySchema = z.enum(['global', 'user_private', 'user_shared']);
export type McpVisibility = z.infer<typeof McpVisibilitySchema>;

export const McpCatalogTemplateSchema = z.object({
    id: z.string().min(1).max(64),
    display_name: z.string().min(1).max(128),
    description: z.string().max(512).optional(),
    transport_type: z.enum(['stdio', 'sse', 'streamable-http']),
    command_template: z.string().optional(),
    args_schema: z.record(z.string(), z.unknown()),
    env_schema: z.record(z.string(), z.unknown()),
    url_template: z.string().optional(),
    is_enabled: z.boolean(),
});
export type McpCatalogTemplate = z.infer<typeof McpCatalogTemplateSchema>;

export const McpFromCatalogPayloadSchema = z.object({
    template_id: z.string().min(1).max(64),
    name: z.string().min(1).max(128).regex(/^[a-zA-Z0-9_-]+$/, {
        message: 'name 은 영숫자/언더스코어/하이픈만 허용',
    }),
    visibility: McpVisibilitySchema.default('user_private'),
    args: z.record(z.string(), z.unknown()).default({}),
    env: z.record(z.string(), z.string()).default({}),
    auto_spawn: z.boolean().default(true),
});
export type McpFromCatalogPayload = z.infer<typeof McpFromCatalogPayloadSchema>;

export const McpInstanceStatusSchema = z.enum(['starting', 'running', 'stopped', 'crashed']);
export type McpInstanceStatus = z.infer<typeof McpInstanceStatusSchema>;

export const McpInstanceSchema = z.object({
    id: z.number(),
    mcp_server_id: z.string(),
    user_id: z.string(),
    pid: z.number().nullable(),
    status: McpInstanceStatusSchema,
    started_at: z.string(),
    stopped_at: z.string().nullable(),
    last_error: z.string().nullable(),
});
export type McpInstance = z.infer<typeof McpInstanceSchema>;
