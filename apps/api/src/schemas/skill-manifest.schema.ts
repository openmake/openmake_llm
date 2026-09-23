/**
 * Skill manifest Zod 스키마.
 *
 * YAML frontmatter (`---...---`) 에 들어가는 필드를 검증한다.
 * 사용처: agents/manifest-validator.ts.
 *
 */
import { z } from 'zod';
import { SKILL_MANIFEST_LIMITS } from '../config/constants';
import { SCHEMA_LIMITS } from '../config/http-data-limits';

const { skillManifest: SM } = SCHEMA_LIMITS;

const ToolBindingSchema = z.object({
    tool_name: z.string().min(1).max(SM.TOOL_NAME_MAX).regex(/^[a-z0-9_:-]+$/i, {
        message: 'tool_name 은 영숫자/언더스코어/콜론/하이픈만 허용',
    }),
    mode: z.enum(['required', 'allowed', 'denied']).default('allowed'),
    args_schema: z.record(z.string(), z.unknown()).optional(),
});

const McpBundleSchema = z.object({
    server_name: z.string().min(1).max(SM.SERVER_NAME_MAX),
    server_config: z.object({
        transport_type: z.enum(['stdio', 'sse', 'streamable-http']),
        command: z.string().optional(),
        args: z.array(z.string()).optional(),
        env: z.record(z.string(), z.string()).optional(),
        url: z.url().optional(),
    }),
    lifecycle: z.enum(['per_chat', 'per_session', 'long_lived']).default('per_chat'),
});

export const SkillManifestFrontmatterSchema = z.object({
    name: z.string().min(1).max(SM.NAME_MAX),
    description: z.string().min(1).max(SKILL_MANIFEST_LIMITS.descriptionMaxChars),
    // 누락 시 'general' — Anthropic/Claude Code 마켓플레이스 SKILL.md 는 category 가 없다
    // (하류 git-ingest 는 이미 `?? 'general'` 폴백 — 스키마만 엄격해 생태계 스킬이 거절되던 것 해소)
    category: z.string().min(1).max(SM.CATEGORY_MAX).default('general'),
    // prerelease/build 메타 허용 (`0.45.0-dev.0` — sentry-cli 실사례, 2026-08-29)
    version: z.string().regex(/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/, { message: 'semver (예: 1.0.0)' }).default('1.0.0'),
    is_public: z.boolean().default(false),
    tool_bindings: z.array(ToolBindingSchema).max(SM.TOOL_BINDINGS_COUNT_MAX).default([]),
    mcp_bundles: z.array(McpBundleSchema).max(SM.MCP_BUNDLES_COUNT_MAX).default([]),
    source_repo: z.url().optional(),
    source_path: z.string().max(SM.SOURCE_PATH_MAX).optional(),
});

export type SkillManifestFrontmatter = z.infer<typeof SkillManifestFrontmatterSchema>;
