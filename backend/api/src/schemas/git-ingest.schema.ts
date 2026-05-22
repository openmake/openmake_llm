/**
 * Git URL → Skill Ingest 입력 Zod 스키마 + URL parser.
 *
 * @module schemas/git-ingest.schema
 */
import { z } from 'zod';
import { SKILL_CATEGORIES } from './skills.schema';

export const importFromGitSchema = z.object({
    gitUrl: z.string().min(3).max(500),
    gitRef: z.string().max(200).optional(),
    gitPath: z.string().max(500)
        .refine(p => !p.includes('..'), 'path traversal 차단 — .. 미허용')
        .optional(),
    accessToken: z.string().max(200).optional(),  // 요청 한정, DB 미저장
    target: z.enum(['user', 'system']).default('user'),
    category: z.enum(SKILL_CATEGORIES).optional(),
});

export type ImportFromGitInput = z.infer<typeof importFromGitSchema>;

/**
 * 다양한 형식의 git URL 을 { owner, repo } 로 정규화.
 * 지원 형식:
 *   - https://github.com/owner/repo
 *   - https://github.com/owner/repo.git
 *   - https://github.com/owner/repo/tree/branch
 *   - git@github.com:owner/repo.git
 *   - owner/repo (단축형)
 *
 * @returns parsed { owner, repo } 또는 null (실패).
 */
export function parseGitUrl(url: string): { owner: string; repo: string } | null {
    const cleaned = url.trim();
    // git@github.com:owner/repo.git
    const ssh = /^git@github\.com:([^/]+)\/([^/.]+?)(?:\.git)?$/.exec(cleaned);
    if (ssh) return { owner: ssh[1], repo: ssh[2] };
    // https://github.com/owner/repo[.git][/...]
    const https = /github\.com\/([^/]+)\/([^/.]+?)(?:\.git)?(?:\/|$)/.exec(cleaned);
    if (https) return { owner: https[1], repo: https[2] };
    // owner/repo 단축형
    const short = /^([a-zA-Z0-9_-]+)\/([a-zA-Z0-9._-]+)$/.exec(cleaned);
    if (short) return { owner: short[1], repo: short[2] };
    return null;
}
