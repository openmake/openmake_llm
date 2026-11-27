/**
 * extension-marketplace 라우트 — `/api/extension-marketplace/*`(매니페스트가 마운트).
 *
 * add-on 게이트가 먼저 돈다: 꺼짐 404 · 조직 허용 목록 밖 403. 게이트가 optionalAuth 로 `req.user` 를 채우므로 여기서는
 * 로그인 여부만 본다(게스트 401). 카탈로그 조회 권한은 갤러리와 같다 — 로그인 사용자 누구나, 켜진 원본만.
 *
 * @module addons/extension-marketplace/routes
 */
import { Router, type Request } from 'express';
import { z } from 'zod';
import { success } from '../../utils/api-response';
import { AppError, asyncHandler, ValidationError } from '../../utils/error-handler';
import { getCatalogVerdicts } from './service';

const verdictQuerySchema = z.object({ catalogId: z.string().min(1).max(200) });

function assertSignedIn(req: Request): void {
    const u = req.user as { id?: unknown; userId?: unknown } | undefined;
    if (!u || (u.id === undefined && u.userId === undefined)) {
        throw new AppError('인증이 필요합니다', 401, true, 'UNAUTHORIZED');
    }
}

export const extensionMarketplaceRouter = Router();

extensionMarketplaceRouter.get('/verdicts', asyncHandler(async (req, res) => {
    assertSignedIn(req);
    const q = verdictQuerySchema.safeParse(req.query);
    if (!q.success) throw new ValidationError('catalogId 가 필요합니다');
    res.json(success(await getCatalogVerdicts(q.data.catalogId)));
}));
