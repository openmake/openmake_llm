/**
 * Git URL → 확장 번들 (plugin.json) Ingest 입력 Zod 스키마.
 *
 * @module schemas/extension-ingest.schema
 */
import { z } from 'zod';

export const importExtensionFromGitSchema = z.object({
    gitUrl: z.string().min(3).max(500),
    gitRef: z.string().max(200).optional(),
    gitPath: z.string().max(500)
        .refine(p => !p.includes('..'), 'path traversal 차단 — .. 미허용')
        .optional(),
    accessToken: z.string().max(200).optional(),  // 요청 한정, DB 미저장
    // marketplace.json 인덱스가 있는 저장소에서 설치할 플러그인 이름
    plugin: z.string().max(120).optional(),
});

export type ImportExtensionFromGitInput = z.infer<typeof importExtensionFromGitSchema>;
