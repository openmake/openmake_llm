/**
 * Agent ingest 입력 Zod schema.
 *
 * @module schemas/agent-ingest.schema
 */
import { z } from 'zod';
import { SCHEMA_LIMITS } from '../config/http-data-limits';

const { ingest: I } = SCHEMA_LIMITS;

export const importAgentFromGitSchema = z.object({
    gitUrl: z.string().min(I.GIT_URL_MIN).max(I.GIT_URL_MAX),
    gitRef: z.string().max(I.GIT_REF_MAX).optional(),
    gitPath: z.string().max(I.GIT_PATH_MAX)
        .refine(p => !p.includes('..'), 'path traversal 차단')
        .optional(),
    accessToken: z.string().max(I.ACCESS_TOKEN_MAX).optional(),
    category: z.string().max(I.CATEGORY_MAX).optional(),
});

export type ImportAgentFromGitInput = z.infer<typeof importAgentFromGitSchema>;
