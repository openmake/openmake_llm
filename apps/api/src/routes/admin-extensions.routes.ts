/**
 * 관리자 확장 현황 API (마켓플레이스 남은 개발계획 v3.7 M3) — 관리자 전용 읽기.
 *
 * - `GET /api/admin/extensions/status` — 화면 노출 여부(`EXTENSION_ADMIN_INVENTORY_ENABLED`)만. 항상 응답한다.
 * - `GET /api/admin/extensions/inventory` — 사용자별 설치 확장·원본·커밋·구성요소·승인 상태·MCP 협상 열 + 원본별 집계(첫 페이지).
 *   커서 페이지(`cursor`·`limit`), 필터 `q`·`userId`·`source`·`status`.
 * - `GET /api/admin/extensions/policy-preview` — 원본 정책(M2)을 강제 ON 으로 적용했을 때 막힐 설치(같은 판정 함수).
 *
 * 플래그 OFF 면 status 외 두 라우트는 404. 타인 정보(소유자 username·email)가 실리므로 관리자만.
 *
 * @module routes/admin-extensions.routes
 */
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { requireAuth, requireAdmin } from '../auth';
import { asyncHandler, AppError } from '../utils/error-handler';
import { success } from '../utils/api-response';
import { validateQuery } from '../middlewares/validation';
import { getPool } from '../data/models/unified-database';
import {
    EXTENSION_ADMIN_INVENTORY_LIMITS as LIMITS,
    isExtensionAdminInventoryEnabled,
} from '../config/extension-admin-inventory';
import { decodeInventoryCursor, EXTENSION_INVENTORY_STATUSES } from '../data/repositories/extension-inventory-repository';
import { listExtensionInventory, previewExtensionSourcePolicy } from '../services/extensions/inventory';

export const adminExtensionsRouter = Router();

export const inventoryQuerySchema = z.object({
    q: z.string().trim().max(LIMITS.QUERY_MAX_CHARS).optional(),
    userId: z.string().trim().min(1).max(200).optional(),
    source: z.string().trim().max(LIMITS.QUERY_MAX_CHARS).optional(),
    status: z.enum(EXTENSION_INVENTORY_STATUSES).optional(),
    cursor: z.string().max(512).optional(),
    limit: z.coerce.number().int().min(1).max(LIMITS.PAGE_MAX).optional(),
});

function assertEnabled(): void {
    if (!isExtensionAdminInventoryEnabled()) throw new AppError('확장 현황이 꺼져 있습니다', 404, true, 'NOT_FOUND');
}

adminExtensionsRouter.get('/extensions/status', requireAuth, requireAdmin, asyncHandler(async (_req: Request, res: Response) => {
    res.json(success({ enabled: isExtensionAdminInventoryEnabled() }));
}));

adminExtensionsRouter.get('/extensions/inventory', requireAuth, requireAdmin, validateQuery(inventoryQuerySchema), asyncHandler(async (req: Request, res: Response) => {
    assertEnabled();
    const q = req.query as z.infer<typeof inventoryQuerySchema>;
    const cursor = q.cursor ? decodeInventoryCursor(q.cursor) : null;
    if (q.cursor && !cursor) throw new AppError('잘못된 커서입니다', 400, true, 'INVALID_CURSOR');
    const page = await listExtensionInventory(getPool(), {
        q: q.q || undefined,
        userId: q.userId,
        source: q.source || undefined,
        status: q.status,
    }, { limit: q.limit ?? LIMITS.PAGE_DEFAULT, cursor });
    res.json(success(page));
}));

adminExtensionsRouter.get('/extensions/policy-preview', requireAuth, requireAdmin, asyncHandler(async (_req: Request, res: Response) => {
    assertEnabled();
    res.json(success(await previewExtensionSourcePolicy(getPool())));
}));
