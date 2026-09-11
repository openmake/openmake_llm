/**
 * @module routes/admin-modality-models
 * @description 전역 모달리티→모델 배정(L3) — admin 전용.
 *
 * "역할&모델"(admin-model-roles.routes)과 별개 축. 외부 fullId 는 서버 공용 키 등록·활성 +
 * LLM_GATEWAY_PROVIDERS 편입이 전제(400). 호출은 LiteLLM 게이트웨이 하나로만 간다.
 *
 * 엔드포인트 (모두 requireAuth + requireAdmin):
 *   GET    /api/admin/modality-models            — 전역 배정 + 코드 기본값 + 실효 해석
 *   PUT    /api/admin/modality-models/:modality  — 배정 (body: { model, params? })
 *   DELETE /api/admin/modality-models/:modality  — 해제 (코드 기본값 복귀)
 */
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { requireAuth, requireAdmin } from '../auth';
import { validate } from '../middlewares/validation';
import { asyncHandler } from '../utils/error-handler';
import { success, badRequest, notFound } from '../utils/api-response';
import { getPool } from '../data/models/unified-database';
import { ModalityModelsRepository } from '../data/repositories/modality-models-repo';
import {
    GLOBAL_MODALITY_SCOPE, MODALITIES, MODALITY_DEFAULTS, MODALITY_LIMITS,
    isModality, sanitizeModalityParams,
} from '../config/modality';
import { clearGlobalModalityCache, validateModalityAssignment } from '../services/modality-resolver';
import { describeEffectiveModalities } from '../controllers/modality-models.controller';
import { getConfig } from '../config';
import { getAuditService } from '../services/AuditService';
import { createLogger } from '../utils/logger';

const logger = createLogger('AdminModalityModelsRoutes');

const putSchema = z.object({
    model: z.string().min(1).max(MODALITY_LIMITS.FULL_ID_MAX_CHARS),
    params: z.record(z.string(), z.union([z.string(), z.number()])).optional(),
});

function adminUserId(req: Request): string | undefined {
    return req.user?.id !== undefined ? String(req.user.id) : undefined;
}

async function auditChange(req: Request, action: string, details: Record<string, unknown>): Promise<void> {
    try {
        await getAuditService().logAudit({ action, userId: adminUserId(req), resourceType: 'modality_model', details });
    } catch (err) {
        logger.error('모달리티 배정 감사 기록 실패 (변경은 반영됨):', { action, details, err });
    }
}

export const adminModalityModelsRouter = Router();
adminModalityModelsRouter.use(requireAuth, requireAdmin);

adminModalityModelsRouter.get('/modality-models', asyncHandler(async (_req: Request, res: Response) => {
    const repo = new ModalityModelsRepository(getPool());
    const [mappings, effective] = await Promise.all([repo.listGlobal(), describeEffectiveModalities(undefined)]);
    res.json(success({
        mappings,
        effective,
        modalities: MODALITIES,
        defaults: MODALITY_DEFAULTS,
        gatewayProviders: getConfig().llmGatewayProviders,
    }));
}));

adminModalityModelsRouter.put('/modality-models/:modality', validate(putSchema), asyncHandler(async (req: Request, res: Response) => {
    const modality = req.params.modality;
    if (!isModality(modality)) {
        res.status(400).json(badRequest(`알 수 없는 modality: '${modality}' (허용: ${MODALITIES.join(', ')})`));
        return;
    }
    const body = req.body as z.infer<typeof putSchema>;
    const fullId = body.model.trim();
    const reason = await validateModalityAssignment(GLOBAL_MODALITY_SCOPE, fullId);
    if (reason) { res.status(400).json(badRequest(reason)); return; }

    const repo = new ModalityModelsRepository(getPool());
    const { row, previous } = await repo.upsert(GLOBAL_MODALITY_SCOPE, modality, fullId, sanitizeModalityParams(modality, body.params));
    clearGlobalModalityCache();
    await auditChange(req, 'admin_global_modality_model_set', { modality, model: fullId, previous });
    logger.info(`전역 모달리티 배정 저장: modality=${modality} model=${fullId}`);
    res.json(success({ mapping: row }));
}));

adminModalityModelsRouter.delete('/modality-models/:modality', asyncHandler(async (req: Request, res: Response) => {
    const modality = req.params.modality;
    if (!isModality(modality)) { res.status(400).json(badRequest(`알 수 없는 modality: '${modality}'`)); return; }
    const repo = new ModalityModelsRepository(getPool());
    const previous = (await repo.get(GLOBAL_MODALITY_SCOPE, modality))?.fullId ?? null;
    const deleted = await repo.delete(GLOBAL_MODALITY_SCOPE, modality);
    if (!deleted) { res.status(404).json(notFound('전역 배정 없음')); return; }
    clearGlobalModalityCache();
    await auditChange(req, 'admin_global_modality_model_unset', { modality, previous });
    logger.info(`전역 모달리티 배정 해제: modality=${modality}`);
    res.json(success({ deleted: true }));
}));
