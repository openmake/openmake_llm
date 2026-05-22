/**
 * MCP server Git ingest 입력 Zod 스키마 (Phase 4).
 *
 * 본 파일은 Task 7 (McpServerIngestService) 의 type 의존성을 만족하기 위한
 * stub. approve/reject 입력 schema 는 Task 8 에서 추가됨.
 *
 * @module schemas/mcp-server-ingest.schema
 */
import { z } from 'zod';

export const importMcpServerFromGitSchema = z.object({
    gitUrl: z.string().min(3).max(500),
    gitRef: z.string().max(200).optional(),
    gitPath: z.string().max(500)
        .refine(p => !p.includes('..'), 'path traversal 차단 — .. 미허용')
        .optional(),
    accessToken: z.string().max(200).optional(),
});

export type ImportMcpServerFromGitInput = z.infer<typeof importMcpServerFromGitSchema>;
