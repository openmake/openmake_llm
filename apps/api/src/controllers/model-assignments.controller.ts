/**
 * @module controllers/model-assignments
 * @description 통합 모델 배정(슬롯) 사용자 CRUD — 역할별·기능별 모델을 하나로 합친 배정(2026-09-24).
 *
 * Endpoints (모두 requireAuth):
 *   GET    /api/users/me/model-assignments        — 슬롯 목록 + 본인 배정 + 실효 해석
 *   PUT    /api/users/me/model-assignments/:slot  — 배정 (body: { model, params? })
 *   DELETE /api/users/me/model-assignments/:slot  — 해제 (전역/기본 폴백 복귀)
 *
 * 검증·저장은 services/model-assignments-service 로 위임(text 슬롯=역할 규칙, modality 슬롯=기능 규칙).
 * 구 엔드포인트(/model-roles·/capability-models)는 어댑터로 같은 테이블을 계속 읽는다.
 */
import { Router, Request } from 'express';
import { z } from 'zod';
import { requireAuth } from '../auth/middleware';
import { validate } from '../middlewares/validation';
import { asyncHandler } from '../utils/error-handler';
import { success, unauthorized } from '../utils/api-response';
import { CAPABILITY_LIMITS } from '../config/capabilities';
import { buildAssignmentsResponse, putAssignment, deleteAssignment } from '../services/model-assignments-service';
import { getAuditService } from '../services/AuditService';
import { createLogger } from '../utils/logger';

const log = createLogger('ModelAssignmentsController');

const putSchema = z.object({
    model: z.string().min(1).max(CAPABILITY_LIMITS.FULL_ID_MAX_CHARS),
    params: z.record(z.string(), z.union([z.string(), z.number()])).optional(),
});

function getUserId(req: Request): string | null {
    if (!req.user) return null;
    if ('userId' in req.user && typeof (req.user as { userId?: unknown }).userId === 'string') {
        return (req.user as { userId: string }).userId;
    }
    if ('id' in req.user) return String(req.user.id);
    return null;
}

async function auditChange(userId: string, action: string, details: Record<string, unknown>): Promise<void> {
    try {
        await getAuditService().logAudit({ action, userId, resourceType: 'model_assignment', details });
    } catch (err) {
        log.error('모델 배정 감사 기록 실패 (배정은 반영됨):', { action, details, err });
    }
}

export function createModelAssignmentsController(): Router {
    const router = Router();

    router.get('/', requireAuth, asyncHandler(async (req, res) => {
        const userId = getUserId(req);
        if (!userId) { res.status(401).json(unauthorized()); return; }
        res.json(success(await buildAssignmentsResponse({ scope: userId, resolutionUserId: userId })));
    }));

    router.put('/:slot', requireAuth, validate(putSchema), asyncHandler(async (req, res) => {
        const userId = getUserId(req);
        if (!userId) { res.status(401).json(unauthorized()); return; }
        const body = req.body as z.infer<typeof putSchema>;
        const { assignment, previous } = await putAssignment({
            scope: userId, slotId: req.params.slot, admin: false, model: body.model, params: body.params,
        });
        await auditChange(userId, 'user_model_assignment_set', { slot: assignment.slot, model: assignment.fullId, previous });
        res.json(success({ assignment }));
    }));

    router.delete('/:slot', requireAuth, asyncHandler(async (req, res) => {
        const userId = getUserId(req);
        if (!userId) { res.status(401).json(unauthorized()); return; }
        const { previous } = await deleteAssignment({ scope: userId, slotId: req.params.slot, admin: false });
        await auditChange(userId, 'user_model_assignment_unset', { slot: req.params.slot, previous });
        res.json(success({ deleted: true }));
    }));

    return router;
}
