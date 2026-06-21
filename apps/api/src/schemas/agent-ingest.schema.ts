/**
 * Agent ingest 입력 Zod schema.
 *
 * @module schemas/agent-ingest.schema
 */
import { z } from 'zod';

export const importAgentFromGitSchema = z.object({
    gitUrl: z.string().min(3).max(500),
    gitRef: z.string().max(200).optional(),
    gitPath: z.string().max(500)
        .refine(p => !p.includes('..'), 'path traversal 차단')
        .optional(),
    accessToken: z.string().max(200).optional(),
    category: z.string().max(50).optional(),
});

export type ImportAgentFromGitInput = z.infer<typeof importAgentFromGitSchema>;
