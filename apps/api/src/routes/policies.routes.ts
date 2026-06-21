/**
 * ============================================================
 * Policies routes — GDPR Phase A Fix 3
 * ============================================================
 *
 * Privacy Policy / Terms of Service 정적 markdown 서빙.
 * - 파일 위치: `apps/legacy-web/public/policies/{type}.{locale}.md`
 * - 응답: raw markdown 텍스트 + frontmatter version 파싱
 * - frontend marked.js 로 렌더링 (modal)
 *
 * 다국어 fallback: 요청 locale 파일 없으면 ko 폴백 (운영자가 최소 ko 보장).
 *
 * 캐시: 5분 (정책 갱신 시 즉시 반영이 critical 아님).
 *
 * @module routes/policies
 */
import { Router, Request, Response } from 'express';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createLogger } from '../utils/logger';
import { success, notFound, badRequest, internalError } from '../utils/api-response';

const log = createLogger('PoliciesRoutes');

const VALID_TYPES = new Set(['privacy', 'terms']);
const VALID_LOCALE_REGEX = /^[a-z]{2,3}(-[A-Z]{2})?$/;  // BCP-47 simplified (ko, en, ko-KR, zh-CN)
const FALLBACK_LOCALE = 'ko';
const CACHE_MAX_AGE_SEC = 300;

/**
 * 정책 파일 디렉토리 — apps/api/dist 또는 src 에서 apps/legacy-web/public/policies 까지 상대 경로.
 * dist 빌드 시 sync-frontend 가 apps/legacy-web/public 을 apps/api/dist/public 으로 복사.
 * 따라서 production 에서는 dist/public/policies, dev 에서는 apps/legacy-web/public/policies.
 */
function getPoliciesDir(): string {
    // 1순위: dist/public/policies (production)
    const distPath = path.join(__dirname, '..', 'public', 'policies');
    // 2순위: apps/legacy-web/public/policies (dev)
    const devPath = path.join(__dirname, '..', '..', '..', '..', 'frontend', 'web', 'public', 'policies');
    return distPath.includes('/dist/') ? distPath : devPath;
}

/**
 * markdown frontmatter 의 version 필드 추출.
 * 형식: `--- ... version: "1.0" ... ---` (YAML 간이 파싱).
 * 미지정 시 'unknown'.
 */
function parseVersion(raw: string): string {
    const match = raw.match(/^---[\s\S]*?version:\s*['"]?([^'"\n]+)['"]?[\s\S]*?---/);
    return match ? match[1].trim() : 'unknown';
}

async function readPolicyFile(type: string, locale: string): Promise<{ content: string; version: string } | null> {
    const dir = getPoliciesDir();
    const filename = `${type}.${locale}.md`;
    const filepath = path.join(dir, filename);

    // path traversal 방어 — filepath 가 dir 아래여야
    if (!filepath.startsWith(dir + path.sep)) {
        log.warn(`[Policies] path traversal 시도 차단: ${filename}`);
        return null;
    }

    try {
        const raw = await fs.readFile(filepath, 'utf-8');
        return { content: raw, version: parseVersion(raw) };
    } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw err;
    }
}

export function createPoliciesRouter(): Router {
    const router = Router();

    /**
     * GET /api/policies/:type/:locale
     * - type: 'privacy' | 'terms'
     * - locale: BCP-47 (예: ko, en, ko-KR). 없는 locale 은 ko 로 fallback.
     */
    router.get('/:type/:locale', async (req: Request, res: Response): Promise<void> => {
        try {
            const { type, locale } = req.params;

            if (!VALID_TYPES.has(type)) {
                res.status(400).json(badRequest(`invalid type: ${type} (privacy|terms 만 허용)`));
                return;
            }
            if (!VALID_LOCALE_REGEX.test(locale)) {
                res.status(400).json(badRequest(`invalid locale: ${locale}`));
                return;
            }

            let result = await readPolicyFile(type, locale);
            let actualLocale = locale;

            // 요청 locale 파일 없으면 fallback 시도
            if (!result && locale !== FALLBACK_LOCALE) {
                result = await readPolicyFile(type, FALLBACK_LOCALE);
                actualLocale = FALLBACK_LOCALE;
            }

            if (!result) {
                res.status(404).json(notFound(`policy not found: ${type}.${locale}.md (fallback ${FALLBACK_LOCALE} 도 없음)`));
                return;
            }

            res.setHeader('Cache-Control', `public, max-age=${CACHE_MAX_AGE_SEC}`);
            res.json(success({
                type,
                locale: actualLocale,
                requestedLocale: locale,
                version: result.version,
                content: result.content,
            }));
        } catch (err) {
            log.error('[Policies] read error:', err);
            res.status(500).json(internalError('정책 문서 조회 실패'));
        }
    });

    return router;
}
