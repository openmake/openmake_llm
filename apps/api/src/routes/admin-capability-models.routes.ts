/**
 * @module routes/admin-capability-models
 * @description 전역 capability→모델 배정(L3) — admin 전용.
 *
 * "역할&모델"(admin-model-roles.routes)과 별개 축. 외부 fullId 는 서버 공용 키 등록·활성 +
 * LLM_GATEWAY_PROVIDERS 편입이 전제(400). 호출은 LiteLLM 게이트웨이 하나로만 간다.
 *
 * 엔드포인트 (모두 requireAuth + requireAdmin):
 *   GET    /api/admin/capability-models            — 전역 배정 + 코드 기본값 + 실효 해석
 *   PUT    /api/admin/capability-models/:capability  — 배정 (body: { model, params? })
 *   DELETE /api/admin/capability-models/:capability  — 해제 (코드 기본값 복귀)
 */
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { requireAuth, requireAdmin } from '../auth';
import { validate } from '../middlewares/validation';
import { asyncHandler } from '../utils/error-handler';
import { success, badRequest, notFound } from '../utils/api-response';
import { getPool } from '../data/models/unified-database';
import { CapabilityModelsRepository } from '../data/repositories/capability-models-repo';
import {
    GLOBAL_CAPABILITY_SCOPE, CAPABILITIES, ASSIGNABLE_CAPABILITIES, CAPABILITY_DEFAULTS, CAPABILITY_LIMITS,
    normalizeCapability, sanitizeCapabilityParams,
} from '../config/capabilities';
import { clearGlobalCapabilityCache, validateCapabilityAssignment } from '../services/orchestrator/capability-resolver';
import { describeEffectiveCapabilities } from '../controllers/capability-models.controller';
import { getConfig } from '../config';
import { getAuditService } from '../services/AuditService';
import { createLogger } from '../utils/logger';

const logger = createLogger('AdminCapabilityModelsRoutes');

const putSchema = z.object({
    model: z.string().min(1).max(CAPABILITY_LIMITS.FULL_ID_MAX_CHARS),
    params: z.record(z.string(), z.union([z.string(), z.number()])).optional(),
});

function adminUserId(req: Request): string | undefined {
    return req.user?.id !== undefined ? String(req.user.id) : undefined;
}

async function auditChange(req: Request, action: string, details: Record<string, unknown>): Promise<void> {
    try {
        await getAuditService().logAudit({ action, userId: adminUserId(req), resourceType: 'capability_model', details });
    } catch (err) {
        logger.error('capability 배정 감사 기록 실패 (변경은 반영됨):', { action, details, err });
    }
}

export const adminCapabilityModelsRouter = Router();
adminCapabilityModelsRouter.use(requireAuth, requireAdmin);

adminCapabilityModelsRouter.get('/capability-models', asyncHandler(async (_req: Request, res: Response) => {
    const repo = new CapabilityModelsRepository(getPool());
    const [mappings, effective] = await Promise.all([repo.listGlobal(), describeEffectiveCapabilities(undefined)]);
    res.json(success({
        mappings,
        effective,
        modalities: CAPABILITIES,
        defaults: CAPABILITY_DEFAULTS,
        gatewayProviders: getConfig().llmGatewayProviders,
    }));
}));

adminCapabilityModelsRouter.put('/capability-models/:capability', validate(putSchema), asyncHandler(async (req: Request, res: Response) => {
    const capability = normalizeCapability(req.params.capability);
    if (!capability || !ASSIGNABLE_CAPABILITIES.includes(capability)) {
        res.status(400).json(badRequest(`배정 불가 capability: '${req.params.capability}' (허용: ${ASSIGNABLE_CAPABILITIES.join(', ')})`));
        return;
    }
    const body = req.body as z.infer<typeof putSchema>;
    const fullId = body.model.trim();
    const reason = await validateCapabilityAssignment(GLOBAL_CAPABILITY_SCOPE, fullId, {}, capability);
    if (reason) { res.status(400).json(badRequest(reason)); return; }

    const repo = new CapabilityModelsRepository(getPool());
    const { row, previous } = await repo.upsert(GLOBAL_CAPABILITY_SCOPE, capability, fullId, sanitizeCapabilityParams(capability, body.params));
    clearGlobalCapabilityCache();
    await auditChange(req, 'admin_global_capability_model_set', { capability, model: fullId, previous });
    logger.info(`전역 capability 배정 저장: capability=${capability} model=${fullId}`);
    res.json(success({ mapping: row }));
}));

adminCapabilityModelsRouter.delete('/capability-models/:capability', asyncHandler(async (req: Request, res: Response) => {
    const capability = normalizeCapability(req.params.capability);
    if (!capability) { res.status(400).json(badRequest(`알 수 없는 capability: '${req.params.capability}'`)); return; }
    const repo = new CapabilityModelsRepository(getPool());
    const previous = (await repo.get(GLOBAL_CAPABILITY_SCOPE, capability))?.fullId ?? null;
    const deleted = await repo.delete(GLOBAL_CAPABILITY_SCOPE, capability);
    if (!deleted) { res.status(404).json(notFound('전역 배정 없음')); return; }
    clearGlobalCapabilityCache();
    await auditChange(req, 'admin_global_capability_model_unset', { capability, previous });
    logger.info(`전역 capability 배정 해제: capability=${capability}`);
    res.json(success({ deleted: true }));
}));
