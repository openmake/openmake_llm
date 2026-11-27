/**
 * 이름 설치 라우트(마켓플레이스 M5) + 그 미리보기(M1b 연장) — user-extensions.controller 가 같은 라우터에 붙인다.
 *
 *   POST /api/users/me/extensions/install-by-name  — `플러그인@마켓플레이스` 를 등록 카탈로그에서 해석해 설치
 *   POST /api/users/me/extensions/preview-by-name  — 같은 해석·같은 설치 입력으로 미리보기(쓰기·LLM 없음,
 *                                                    EXTENSION_INSTALL_PREVIEW_ENABLED — OFF 면 404)
 *
 * 두 라우트는 `namedInstallInput` 하나로 설치 엔진 입력을 만든다 — 미리보기 구성요소 = 실제 설치 Draft 구성요소.
 * 모르는 이름은 둘 다 후보만 400 으로(자동 치환 없음).
 *
 * @module controllers/user-extensions-named.routes
 */
import type { Router, Request } from 'express';
import { z } from 'zod';
import { requireAuth } from '../auth/middleware';
import { validate } from '../middlewares/validation';
import { getPool } from '../data/models/unified-database';
import { ExtensionCatalogRepository } from '../data/repositories/extension-catalog-repository';
import { NAMED_INSTALL_LIMITS } from '../config/extension-named-install';
import { NamedInstallError, namedInstallInput, resolveNamedInstall } from '../services/extensions/named-install';
import { extensionInstallPreviewEnabled } from '../config/extension-install-preview';
import { buildExtensionIngestService } from '../services/extensions/ingest-service-factory';
import { createLogger } from '../utils/logger';
import { success, unauthorized, notFound, badRequest } from '../utils/api-response';
import type { ImportResult } from '../agents/git-ingest/extension-ingest-types';

const log = createLogger('UserExtensionsNamedRoutes');

export const namedInstallSchema = z.object({
    ref: z.string().min(3).max(NAMED_INSTALL_LIMITS.NAME_MAX_CHARS * 2 + 1),
    accessToken: z.string().max(200).optional(),
});

export interface NamedRouteDeps {
    getUserId(req: Request): string | null;
    /** 원본 정책 거절(403)은 400 변환을 타지 않고 전역 errorHandler 로 */
    rethrowPolicyError(err: unknown): void;
    installSummary(result: ImportResult): object;
}

/** 해석 실패는 후보와 함께 400, 그 밖의 실패는 접두어를 붙인 400 */
function namedFailure(err: unknown, prefix: string) {
    const msg = err instanceof Error ? err.message : String(err);
    return err instanceof NamedInstallError
        ? badRequest(msg, { code: err.code, candidates: err.candidates })
        : badRequest(`${prefix}: ${msg}`);
}

export function registerNamedInstallRoutes(router: Router, deps: NamedRouteDeps): void {
    router.post('/install-by-name', requireAuth, validate(namedInstallSchema), async (req, res) => {
        const userId = deps.getUserId(req);
        if (!userId) { res.status(401).json(unauthorized()); return; }
        const body = req.body as z.infer<typeof namedInstallSchema>;
        try {
            const target = await resolveNamedInstall(body.ref, new ExtensionCatalogRepository(getPool()));
            const service = await buildExtensionIngestService();
            // 원본 정책(M2)은 설치 엔진이 해석된 원본 URL 로 검사
            const result = await service.import(namedInstallInput(target, { userId, accessToken: body.accessToken }));
            if ('selectionRequired' in result && result.selectionRequired) {
                res.status(400).json(badRequest(`플러그인을 특정하지 못했습니다: ${body.ref}`));
                return;
            }
            log.info(`named install: ${body.ref} → ${result.extensionId} (user=${userId})`);
            res.json(success({ ...deps.installSummary(result), source: { id: target.sourceId, marketplace: target.marketplace, plugin: target.plugin } }));
        } catch (err) {
            deps.rethrowPolicyError(err);
            log.warn(`named install 실패: ${err instanceof Error ? err.message : String(err)}`);
            res.status(400).json(namedFailure(err, '이름 설치 실패'));
        }
    });

    // 이름 설치 미리보기(opt-in) — 카탈로그 미리보기와 같은 service.preview, 입력은 위 설치와 같은 namedInstallInput
    router.post('/preview-by-name', requireAuth, validate(namedInstallSchema), async (req, res) => {
        if (!extensionInstallPreviewEnabled()) { res.status(404).json(notFound('설치 미리보기가 꺼져 있습니다')); return; }
        const userId = deps.getUserId(req);
        if (!userId) { res.status(401).json(unauthorized()); return; }
        const body = req.body as z.infer<typeof namedInstallSchema>;
        try {
            const target = await resolveNamedInstall(body.ref, new ExtensionCatalogRepository(getPool()));
            const service = await buildExtensionIngestService();
            const result = await service.preview(namedInstallInput(target, { userId, accessToken: body.accessToken }));
            if ('selectionRequired' in result && result.selectionRequired) {
                res.status(400).json(badRequest(`플러그인을 특정하지 못했습니다: ${body.ref}`));
                return;
            }
            res.json(success({ ...result, namedSource: { id: target.sourceId, marketplace: target.marketplace, plugin: target.plugin } }));
        } catch (err) {
            deps.rethrowPolicyError(err);
            log.warn(`named preview 실패: ${err instanceof Error ? err.message : String(err)}`);
            res.status(400).json(namedFailure(err, '설치 미리보기 실패'));
        }
    });
}
