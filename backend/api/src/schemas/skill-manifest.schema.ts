/**
 * Skill manifest Zod 스키마.
 *
 * YAML frontmatter (`---...---`) 에 들어가는 필드를 검증한다.
 * 사용처: agents/manifest-validator.ts.
 *
 * 참조: docs/superpowers/plans/2026-05-20-phase5-skill-upload.md §4.1.2
 */
import { z } from 'zod';

const ToolBindingSchema = z.object({
    tool_name: z.string().min(1).max(128).regex(/^[a-z0-9_:-]+$/i, {
        message: 'tool_name 은 영숫자/언더스코어/콜론/하이픈만 허용',
    }),
    mode: z.enum(['required', 'allowed', 'denied']).default('allowed'),
    args_schema: z.record(z.string(), z.unknown()).optional(),
});

const McpBundleSchema = z.object({
    server_name: z.string().min(1).max(64),
    server_config: z.object({
        transport_type: z.enum(['stdio', 'sse', 'streamable-http']),
        command: z.string().optional(),
        args: z.array(z.string()).optional(),
        env: z.record(z.string(), z.string()).optional(),
        url: z.string().url().optional(),
    }),
    lifecycle: z.enum(['per_chat', 'per_session', 'long_lived']).default('per_chat'),
});

export const SkillManifestFrontmatterSchema = z.object({
    name: z.string().min(1).max(128),
    description: z.string().min(1).max(1024),
    category: z.string().min(1).max(64),
    version: z.string().regex(/^\d+\.\d+\.\d+$/, { message: 'semver (예: 1.0.0)' }).default('1.0.0'),
    is_public: z.boolean().default(false),
    tool_bindings: z.array(ToolBindingSchema).max(64).default([]),
    mcp_bundles: z.array(McpBundleSchema).max(8).default([]),
    source_repo: z.string().url().optional(),
    source_path: z.string().max(256).optional(),
});

export type SkillManifestFrontmatter = z.infer<typeof SkillManifestFrontmatterSchema>;
export type SkillToolBinding = z.infer<typeof ToolBindingSchema>;
export type SkillMcpBundle = z.infer<typeof McpBundleSchema>;
