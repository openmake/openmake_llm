/**
 * @module controllers/modality-models
 * @description 사용자별 모달리티→모델 오버라이드 CRUD.
 *
 * "역할&모델"(user-model-roles.controller)과 별개 축 — 이미지·비전·영상·오디오·임베딩을
 * 어느 모델이 처리하는지. 텍스트 생성은 여기 없다.
 *
 * Endpoints (모두 requireAuth):
 *   GET    /api/users/me/modality-models             — 본인 오버라이드 + 실효(effective) 해석 결과
 *   PUT    /api/users/me/modality-models/:modality   — 배정 (body: { model, params? })
 *   DELETE /api/users/me/modality-models/:modality   — 해제 (전역/기본 폴백 복귀)
 *
 * PUT 검증(services/modality-resolver validateModalityAssignment):
 *   외부 fullId → 카탈로그·openai-compatible·LLM_GATEWAY_PROVIDERS 편입·BYOK 키 등록/활성/비OAuth
 */
import { Router, Request } from 'express';
import { z } from 'zod';
import { requireAuth } from '../auth/middleware';
import { validate } from '../middlewares/validation';
import { getPool } from '../data/models/unified-database';
import { ModalityModelsRepository } from '../data/repositories/modality-models-repo';
import {
    MODALITIES, MODALITY_LIMITS, USER_ASSIGNABLE_MODALITIES,
    isModality, sanitizeModalityParams, type Modality,
} from '../config/modality';
import {
    resolveModalityTarget, validateModalityAssignment, ModalityUnavailableError,
} from '../services/modality-resolver';
import { getAuditService } from '../services/AuditService';
import { createLogger } from '../utils/logger';
import { success, internalError, unauthorized, badRequest, notFound } from '../utils/api-response';

const log = createLogger('ModalityModelsController');

const putSchema = z.object({
    model: z.string().min(1).max(MODALITY_LIMITS.FULL_ID_MAX_CHARS),
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

function parseAssignable(value: string): Modality | null {
    return isModality(value) && USER_ASSIGNABLE_MODALITIES.includes(value) ? value : null;
}

async function auditChange(userId: string, action: string, details: Record<string, unknown>): Promise<void> {
    try {
        await getAuditService().logAudit({ action, userId, resourceType: 'modality_model', details });
    } catch (err) {
        log.error('모달리티 배정 감사 기록 실패 (배정은 반영됨):', { action, details, err });
    }
}

/** 실효 해석 — 각 모달리티가 지금 어느 모델로 가는지(키 노출 없음). 실패는 code 로 노출. */
export async function describeEffectiveModalities(userId: string | undefined): Promise<Array<{
    modality: Modality; fullId?: string; source?: string; error?: string; code?: string;
}>> {
    return Promise.all(MODALITIES.map(async (modality) => {
        try {
            const t = await resolveModalityTarget(modality, userId);
            return { modality, fullId: t.fullId, source: t.source };
        } catch (err) {
            if (err instanceof ModalityUnavailableError) return { modality, error: err.message, code: err.code };
            return { modality, error: err instanceof Error ? err.message : String(err) };
        }
    }));
}

export function createModalityModelsController(): Router {
    const router = Router();

    router.get('/', requireAuth, async (req, res) => {
        const userId = getUserId(req);
        if (!userId) { res.status(401).json(unauthorized()); return; }
        try {
            const repo = new ModalityModelsRepository(getPool());
            const [overrides, effective] = await Promise.all([
                repo.listByScope(userId),
                describeEffectiveModalities(userId),
            ]);
            res.json(success({ overrides, effective, assignableModalities: USER_ASSIGNABLE_MODALITIES }));
        } catch (err) {
            log.error('list 실패:', err);
            res.status(500).json(internalError('모달리티 배정 목록 조회 실패'));
        }
    });

    router.put('/:modality', requireAuth, validate(putSchema), async (req, res) => {
        const userId = getUserId(req);
        if (!userId) { res.status(401).json(unauthorized()); return; }
        const modality = parseAssignable(req.params.modality);
        if (!modality) {
            res.status(400).json(badRequest(`배정 불가 modality: '${req.params.modality}' (허용: ${USER_ASSIGNABLE_MODALITIES.join(', ')})`));
            return;
        }
        try {
            const body = req.body as z.infer<typeof putSchema>;
            const fullId = body.model.trim();
            const reason = await validateModalityAssignment(userId, fullId, {}, modality);
            if (reason) { res.status(400).json(badRequest(reason)); return; }

            const params = sanitizeModalityParams(modality, body.params);
            const repo = new ModalityModelsRepository(getPool());
            const { row, previous } = await repo.upsert(userId, modality, fullId, params);
            log.info(`모달리티 배정 저장: userId=${userId} modality=${modality} model=${fullId}`);
            await auditChange(userId, 'user_modality_model_set', { modality, model: fullId, previous });
            res.json(success({ mapping: row }));
        } catch (err) {
            log.error('upsert 실패:', err);
            res.status(500).json(internalError('모달리티 배정 저장 실패'));
        }
    });

    router.delete('/:modality', requireAuth, async (req, res) => {
        const userId = getUserId(req);
        if (!userId) { res.status(401).json(unauthorized()); return; }
        const modality = parseAssignable(req.params.modality);
        if (!modality) { res.status(400).json(badRequest(`배정 불가 modality: '${req.params.modality}'`)); return; }
        try {
            const repo = new ModalityModelsRepository(getPool());
            const previous = (await repo.get(userId, modality))?.fullId ?? null;
            const deleted = await repo.delete(userId, modality);
            if (!deleted) { res.status(404).json(notFound('배정 없음')); return; }
            log.info(`모달리티 배정 해제: userId=${userId} modality=${modality}`);
            await auditChange(userId, 'user_modality_model_unset', { modality, previous });
            res.json(success({ deleted: true }));
        } catch (err) {
            log.error('delete 실패:', err);
            res.status(500).json(internalError('모달리티 배정 해제 실패'));
        }
    });

    return router;
}
