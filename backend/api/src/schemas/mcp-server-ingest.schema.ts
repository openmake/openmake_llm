/**
 * MCP server Git ingest REST 입력 스키마 (Phase 4).
 *
 * - importMcpServerFromGitSchema: POST /api/mcp/servers/import-from-git
 * - approveMcpServerDraftSchema:  POST /api/mcp/servers/:id/approve
 *
 * @module schemas/mcp-server-ingest.schema
 */
import { z } from 'zod';

const GIT_URL_RE = /^(https:\/\/github\.com\/[\w.-]+\/[\w.-]+(?:\.git)?(?:\/.*)?|[\w.-]+\/[\w.-]+)$/;

export const importMcpServerFromGitSchema = z.object({
    gitUrl: z.string()
        .min(3)
        .max(400)
        .regex(GIT_URL_RE, 'gitUrl 은 https://github.com/owner/repo 또는 단축 owner/repo 형식이어야 합니다'),
    gitRef: z.string().max(200).optional(),
    gitPath: z.string().max(300)
        .refine(p => !p.includes('..'), 'path traversal 차단 — .. 미허용')
        .optional(),
    accessToken: z.string().min(1).max(200).optional(),
});

export type ImportMcpServerFromGitInput = z.infer<typeof importMcpServerFromGitSchema>;

export const approveMcpServerDraftSchema = z.object({
    envOverrides: z.record(z.string().min(1).max(200), z.string().max(2000)).optional(),
    enableImmediately: z.boolean().optional(),
});

export type ApproveMcpServerDraftInput = z.infer<typeof approveMcpServerDraftSchema>;
