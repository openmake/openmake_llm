/**
 * MCP server Git ingest REST 입력 스키마 (Phase 4).
 *
 * - importMcpServerFromGitSchema: POST /api/mcp/servers/import-from-git
 * - approveMcpServerDraftSchema:  POST /api/mcp/servers/:id/approve
 *
 * @module schemas/mcp-server-ingest.schema
 */
import { z } from 'zod';
import { SCHEMA_LIMITS } from '../config/http-data-limits';

const { ingest: I } = SCHEMA_LIMITS;

const GIT_URL_RE = /^(https:\/\/github\.com\/[\w.-]+\/[\w.-]+(?:\.git)?(?:\/.*)?|[\w.-]+\/[\w.-]+)$/;

export const importMcpServerFromGitSchema = z.object({
    gitUrl: z.string()
        .min(I.MCP_GIT_URL_MIN)
        .max(I.MCP_GIT_URL_MAX)
        .regex(GIT_URL_RE, 'gitUrl 은 https://github.com/owner/repo 또는 단축 owner/repo 형식이어야 합니다'),
    gitRef: z.string().max(I.GIT_REF_MAX).optional(),
    gitPath: z.string().max(I.MCP_GIT_PATH_MAX)
        .refine(p => !p.includes('..'), 'path traversal 차단 — .. 미허용')
        .optional(),
    accessToken: z.string().min(1).max(I.ACCESS_TOKEN_MAX).optional(),
});

export type ImportMcpServerFromGitInput = z.infer<typeof importMcpServerFromGitSchema>;

export const approveMcpServerDraftSchema = z.object({
    envOverrides: z.record(z.string().min(1).max(I.ENV_KEY_MAX), z.string().max(I.ENV_VALUE_MAX)).optional(),
    enableImmediately: z.boolean().optional(),
});

