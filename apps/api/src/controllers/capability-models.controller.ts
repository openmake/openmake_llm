/**
 * @module controllers/capability-models
 * @description 사용자별 capability→모델 오버라이드 CRUD.
 *
 * "역할&모델"(user-model-roles.controller)과 별개 축 — 이미지·비전·영상·오디오·임베딩을
 * 어느 모델이 처리하는지. 텍스트 생성은 여기 없다.
 *
 * Endpoints (모두 requireAuth):
 *   GET    /api/users/me/capability-models             — 본인 오버라이드 + 실효(effective) 해석 결과
 *   PUT    /api/users/me/capability-models/:capability   — 배정 (body: { model, params? })
 *   DELETE /api/users/me/capability-models/:capability   — 해제 (전역/기본 폴백 복귀)
 *
 * PUT 검증(services/orchestrator/capability-resolver validateCapabilityAssignment):
 *   외부 fullId → 카탈로그·openai-compatible·LLM_GATEWAY_PROVIDERS 편입·BYOK 키 등록/활성/비OAuth
 */
import { Router, Request } from 'express';
import { z } from 'zod';
import { requireAuth } from '../auth/middleware';
import { validate } from '../middlewares/validation';
import { getPool } from '../data/models/unified-database';
import { CapabilityModelsRepository } from '../data/repositories/capability-models-repo';
import {
    CAPABILITIES, CAPABILITY_LIMITS, ASSIGNABLE_CAPABILITIES,
    normalizeCapability, sanitizeCapabilityParams, type Capability,
} from '../config/capabilities';
import {
    resolveCapabilityTarget, validateCapabilityAssignment, CapabilityUnavailableError,
} from '../services/orchestrator/capability-resolver';
import { getAuditService } from '../services/AuditService';
import { createLogger } from '../utils/logger';
import { success, internalError, unauthorized, badRequest, notFound } from '../utils/api-response';

const log = createLogger('CapabilityModelsController');

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

function parseAssignable(value: string): Capability | null {
    const cap = normalizeCapability(value);
    return cap && ASSIGNABLE_CAPABILITIES.includes(cap) ? cap : null;
}

async function auditChange(userId: string, action: string, details: Record<string, unknown>): Promise<void> {
    try {
        await getAuditService().logAudit({ action, userId, resourceType: 'capability_model', details });
    } catch (err) {
        log.error('capability 배정 감사 기록 실패 (배정은 반영됨):', { action, details, err });
    }
}

/** 실효 해석 — 각 capability가 지금 어느 모델로 가는지(키 노출 없음). 실패는 code 로 노출. */
export async function describeEffectiveCapabilities(userId: string | undefined): Promise<Array<{
    capability: Capability; fullId?: string; source?: string; error?: string; code?: string;
}>> {
    // 배정 대상(ASSIGNABLE)만 — text.synthesize(채팅 모델)·web.search(검색 오케스트레이터)는 모델 배정이 없다
    return Promise.all(ASSIGNABLE_CAPABILITIES.map(async (capability) => {
        try {
            const t = await resolveCapabilityTarget(capability, userId);
            return { capability, fullId: t.fullId, source: t.source };
        } catch (err) {
            if (err instanceof CapabilityUnavailableError) return { capability, error: err.message, code: err.code };
            return { capability, error: err instanceof Error ? err.message : String(err) };
        }
    }));
}

export function createCapabilityModelsController(): Router {
    const router = Router();

    router.get('/', requireAuth, async (req, res) => {
        const userId = getUserId(req);
        if (!userId) { res.status(401).json(unauthorized()); return; }
        try {
            const repo = new CapabilityModelsRepository(getPool());
            const [overrides, effective] = await Promise.all([
                repo.listByScope(userId),
                describeEffectiveCapabilities(userId),
            ]);
            res.json(success({ overrides, effective, assignableCapabilities: ASSIGNABLE_CAPABILITIES }));
        } catch (err) {
            log.error('list 실패:', err);
            res.status(500).json(internalError('capability 배정 목록 조회 실패'));
        }
    });

    router.put('/:capability', requireAuth, validate(putSchema), async (req, res) => {
        const userId = getUserId(req);
        if (!userId) { res.status(401).json(unauthorized()); return; }
        const capability = parseAssignable(req.params.capability);
        if (!capability) {
            res.status(400).json(badRequest(`배정 불가 capability: '${req.params.capability}' (허용: ${ASSIGNABLE_CAPABILITIES.join(', ')})`));
            return;
        }
        try {
            const body = req.body as z.infer<typeof putSchema>;
            const fullId = body.model.trim();
            const reason = await validateCapabilityAssignment(userId, fullId, {}, capability);
            if (reason) { res.status(400).json(badRequest(reason)); return; }

            const params = sanitizeCapabilityParams(capability, body.params);
            const repo = new CapabilityModelsRepository(getPool());
            const { row, previous } = await repo.upsert(userId, capability, fullId, params);
            log.info(`capability 배정 저장: userId=${userId} capability=${capability} model=${fullId}`);
            await auditChange(userId, 'user_capability_model_set', { capability, model: fullId, previous });
            res.json(success({ mapping: row }));
        } catch (err) {
            log.error('upsert 실패:', err);
            res.status(500).json(internalError('capability 배정 저장 실패'));
        }
    });

    router.delete('/:capability', requireAuth, async (req, res) => {
        const userId = getUserId(req);
        if (!userId) { res.status(401).json(unauthorized()); return; }
        const capability = parseAssignable(req.params.capability);
        if (!capability) { res.status(400).json(badRequest(`배정 불가 capability: '${req.params.capability}'`)); return; }
        try {
            const repo = new CapabilityModelsRepository(getPool());
            const previous = (await repo.get(userId, capability))?.fullId ?? null;
            const deleted = await repo.delete(userId, capability);
            if (!deleted) { res.status(404).json(notFound('배정 없음')); return; }
            log.info(`capability 배정 해제: userId=${userId} capability=${capability}`);
            await auditChange(userId, 'user_capability_model_unset', { capability, previous });
            res.json(success({ deleted: true }));
        } catch (err) {
            log.error('delete 실패:', err);
            res.status(500).json(internalError('capability 배정 해제 실패'));
        }
    });

    return router;
}
