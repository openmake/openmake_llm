/**
 * Git URL → 확장 번들 (plugin.json) Ingest 입력 Zod 스키마.
 *
 * @module schemas/extension-ingest.schema
 */
import { z } from 'zod';
import { SCHEMA_LIMITS } from '../config/http-data-limits';

const { ingest: I } = SCHEMA_LIMITS;

export const importExtensionFromGitSchema = z.object({
    gitUrl: z.string().min(I.GIT_URL_MIN).max(I.GIT_URL_MAX),
    gitRef: z.string().max(I.GIT_REF_MAX).optional(),
    gitPath: z.string().max(I.GIT_PATH_MAX)
        .refine(p => !p.includes('..'), 'path traversal 차단 — .. 미허용')
        .optional(),
    accessToken: z.string().max(I.ACCESS_TOKEN_MAX).optional(),  // 요청 한정, DB 미저장
    // marketplace.json 인덱스가 있는 저장소에서 설치할 플러그인 이름
    plugin: z.string().max(I.PLUGIN_MAX).optional(),
});

export type ImportExtensionFromGitInput = z.infer<typeof importExtensionFromGitSchema>;
