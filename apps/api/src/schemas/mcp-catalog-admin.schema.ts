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
import { SCHEMA_LIMITS } from '../config/http-data-limits';

const { mcpCatalogAdmin: CA } = SCHEMA_LIMITS;

const TRANSPORT = z.enum(['stdio', 'sse', 'streamable-http']);

// args_schema / env_schema 는 JSON Schema object — 깊은 검증은 admin 의 책임.
// 여기서는 object 인지만 검증.
const JSON_SCHEMA_OBJECT = z.record(z.string(), z.unknown());

export const createCatalogTemplateSchema = z.object({
    id: z.string()
        .min(CA.ID_MIN)
        .max(CA.ID_MAX)
        .regex(/^mcp-[a-z0-9][a-z0-9-]*$/, 'id 는 "mcp-" 로 시작하는 소문자/숫자/하이픈만 허용'),
    display_name: z.string().min(1).max(CA.DISPLAY_NAME_MAX),
    description: z.string().max(CA.DESCRIPTION_MAX).optional().nullable(),
    transport_type: TRANSPORT,
    command_template: z.string().max(CA.COMMAND_TEMPLATE_MAX).optional().nullable(),
    args_schema: JSON_SCHEMA_OBJECT.optional(),
    env_schema: JSON_SCHEMA_OBJECT.optional(),
    url_template: z.string().max(CA.URL_TEMPLATE_MAX).optional().nullable(),
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

export const updateCatalogTemplateSchema = z.object({
    display_name: z.string().min(1).max(CA.DISPLAY_NAME_MAX).optional(),
    description: z.string().max(CA.DESCRIPTION_MAX).nullable().optional(),
    transport_type: TRANSPORT.optional(),
    command_template: z.string().max(CA.COMMAND_TEMPLATE_MAX).nullable().optional(),
    args_schema: JSON_SCHEMA_OBJECT.optional(),
    env_schema: JSON_SCHEMA_OBJECT.optional(),
    url_template: z.string().max(CA.URL_TEMPLATE_MAX).nullable().optional(),
    is_enabled: z.boolean().optional(),
});


/** 인가 URL 에 덧붙일 provider 파라미터 키 — 소문자·숫자·밑줄만(예약 키 필터는 provider 가 한 번 더 한다) */
const AUTHORIZATION_PARAM_KEY = /^[a-z][a-z0-9_]{0,39}$/;

/**
 * 원격 MCP 사전 등록 OAuth 클라이언트(155, 계획 R-3). clientSecret: 생략=기존 유지, null=제거.
 * secret 은 write-only — 조회 응답엔 hasSecret 만 나간다.
 */
export const catalogOAuthClientSchema = z.object({
    clientId: z.string().trim().min(1).max(CA.CLIENT_ID_MAX),
    clientSecret: z.string().min(1).max(CA.CLIENT_SECRET_MAX).nullable().optional(),
    tokenEndpointAuthMethod: z.enum(['client_secret_post', 'client_secret_basic', 'none']).nullable().optional(),
    scope: z.string().trim().max(CA.SCOPE_MAX).nullable().optional(),
    authorizationParams: z.record(z.string().regex(AUTHORIZATION_PARAM_KEY), z.string().max(CA.AUTH_PARAM_VALUE_MAX))
        .refine((o) => Object.keys(o).length <= 10, '인가 파라미터는 10개까지')
        .optional(),
});
