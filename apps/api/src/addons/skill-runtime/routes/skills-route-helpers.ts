/**
 * Skills Routes 보조 — skills.routes.ts 에서 분리한 순수 헬퍼 (max-lines 가드).
 *
 * - skillCreateKeyGen: Skill Creator rate limiter 키 생성기
 * - skillUpload: .SKILL 업로드 multer
 * - mapGitIngestErrorToStatus: Git ingest 오류 코드 → HTTP 상태
 *
 * @module addons/skill-runtime/routes/skills-route-helpers
 */

import { Request } from 'express';
import multer from 'multer';
import { ipKeyGenerator } from 'express-rate-limit';

export function skillCreateKeyGen(prefix: string) {
    return (req: Request): string => {
        const uid = req.user
            ? ('userId' in req.user ? (req.user as { userId: string }).userId : req.user.id?.toString())
            : undefined;
        return uid ? `${prefix}:user:${uid}` : `${prefix}:ip:${ipKeyGenerator(req.ip || 'unknown')}`;
    };
}

// .SKILL 업로드 multer (memoryStorage, 256KB 제한, P5-D7)
export const skillUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 256 * 1024 },
    fileFilter: (_req, file, cb) => {
        const lower = file.originalname.toLowerCase();
        if (lower.endsWith('.skill') || lower.endsWith('.md')) {
            cb(null, true);
        } else {
            cb(new Error('.SKILL 또는 .md 파일만 허용됩니다'));
        }
    },
});

export function mapGitIngestErrorToStatus(code: string): number {
    switch (code) {
        case 'INVALID_GIT_URL': case 'INVALID_REF': case 'MANIFEST_INVALID': return 400;
        case 'REPO_NOT_FOUND': return 404;
        case 'NO_SKILL_FOUND': return 422;
        case 'GITHUB_RATE_LIMITED': case 'DRAFT_LIMIT_EXCEEDED': return 429;
        case 'FILE_TOO_LARGE': case 'UPSTREAM_FETCH_FAIL': return 502;
        default: return 500;
    }
}
