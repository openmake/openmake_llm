/**
 * @module routes/admin-model-assignments
 * @description 전역 모델 배정(슬롯, scope='__global__') — admin 전용(2026-09-24).
 *
 * 엔드포인트 (모두 requireAuth + requireAdmin):
 *   GET    /api/admin/model-assignments        — 슬롯 목록 + 전역 배정 + 실효 해석(전역 티어)
 *   PUT    /api/admin/model-assignments/:slot  — 배정 (body: { model, params? }) — chat·router 비배정 슬롯도 허용
 *   DELETE /api/admin/model-assignments/:slot  — 해제
 *
 * 검증·저장은 구 관리자 역할·기능 라우트와 같은 규칙(services/model-assignments-service, 전역=서버 공용 키 규칙).
 * 전역 변경은 role·capability 해석 캐시를 함께 무효화한다(슬롯 공유).
 */
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { requireAuth, requireAdmin } from '../auth';
import { validate } from '../middlewares/validation';
import { asyncHandler } from '../utils/error-handler';
import { success } from '../utils/api-response';
import { GLOBAL_CAPABILITY_SCOPE, CAPABILITY_LIMITS } from '../config/capabilities';
import { buildAssignmentsResponse, putAssignment, deleteAssignment } from '../services/model-assignments-service';
import { getAuditService } from '../services/AuditService';
import { createLogger } from '../utils/logger';

const logger = createLogger('AdminModelAssignmentsRoutes');

const putSchema = z.object({
    model: z.string().min(1).max(CAPABILITY_LIMITS.FULL_ID_MAX_CHARS),
    params: z.record(z.string(), z.union([z.string(), z.number()])).optional(),
});

function adminUserId(req: Request): string | undefined {
    return req.user?.id !== undefined ? String(req.user.id) : undefined;
}

async function auditChange(req: Request, action: string, details: Record<string, unknown>): Promise<void> {
    try {
        await getAuditService().logAudit({ action, userId: adminUserId(req), resourceType: 'model_assignment', details });
    } catch (err) {
        logger.error('전역 모델 배정 감사 기록 실패 (변경은 반영됨):', { action, details, err });
    }
}

export const adminModelAssignmentsRouter = Router();
adminModelAssignmentsRouter.use('/model-assignments', requireAuth, requireAdmin);

adminModelAssignmentsRouter.get('/model-assignments', asyncHandler(async (_req: Request, res: Response) => {
    res.json(success(await buildAssignmentsResponse({ scope: GLOBAL_CAPABILITY_SCOPE, resolutionUserId: undefined })));
}));

adminModelAssignmentsRouter.put('/model-assignments/:slot', validate(putSchema), asyncHandler(async (req: Request, res: Response) => {
    const body = req.body as z.infer<typeof putSchema>;
    const { assignment, previous } = await putAssignment({
        scope: GLOBAL_CAPABILITY_SCOPE, slotId: req.params.slot, admin: true, model: body.model, params: body.params,
    });
    await auditChange(req, 'admin_global_model_assignment_set', { slot: assignment.slot, model: assignment.fullId, previous });
    logger.info(`전역 모델 배정 저장: slot=${assignment.slot} model=${assignment.fullId}`);
    res.json(success({ assignment }));
}));

adminModelAssignmentsRouter.delete('/model-assignments/:slot', asyncHandler(async (req: Request, res: Response) => {
    const { previous } = await deleteAssignment({ scope: GLOBAL_CAPABILITY_SCOPE, slotId: req.params.slot, admin: true });
    await auditChange(req, 'admin_global_model_assignment_unset', { slot: req.params.slot, previous });
    res.json(success({ deleted: true }));
}));
