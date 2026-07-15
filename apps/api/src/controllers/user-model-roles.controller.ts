/**
 * @module controllers/user-model-roles
 * @description 사용자별 역할→모델 매핑 CRUD (Role-based Multi-Agent Orchestration Phase 2).
 *
 * Endpoints (모두 requireAuth):
 *   GET    /api/users/me/model-roles        — 본인 매핑 목록 + 배정 가능 role 카탈로그
 *   PUT    /api/users/me/model-roles/:role  — 배정/변경 (body: { model })
 *   DELETE /api/users/me/model-roles/:role  — 매핑 해제 (전역/기본 폴백으로 복귀)
 *
 * PUT 검증:
 *   - role ∈ USER_ASSIGNABLE_MODEL_ROLES (agent/judge/research/spawn/review)
 *   - 외부 fullId → 해당 provider BYOK 키 등록·활성 필수 (400)
 *     + sdkType 은 openai-compatible 만 (role 실행 경로 제약)
 *   - 로컬 태그 → LiteLLM /v1/models 대조 (LLM 서버 무응답 시 형식 검증만 — fail-open,
 *     external-keys validate 와 동일한 저장-유지 정책)
 *
 * @see services/model-role-resolver — 해석(3단 폴백) 소비자
 * @see db/migrations/069_user_model_roles.sql
 */
import { Router, Request } from 'express';
import { z } from 'zod';
import { requireAuth } from '../auth/middleware';
import { validate } from '../middlewares/validation';
import { getPool } from '../data/models/unified-database';
import { UserModelRolesRepository } from '../data/repositories/user-model-roles-repo';
import { ExternalKeysRepository } from '../data/repositories/external-keys-repo';
import {
    ModelRole,
    USER_ASSIGNABLE_MODEL_ROLES,
    isExternalFullId,
    toLocalModelTag,
} from '../config/model-roles';
import { EXTERNAL_PROVIDER_CATALOG } from '../config/external-providers';
import { createClient } from '../llm/client';
import { createLogger } from '../utils/logger';
import { success, internalError, unauthorized, badRequest, notFound } from '../utils/api-response';

const log = createLogger('UserModelRolesController');

const MAX_MODEL_ID_CHARS = 200;

const putSchema = z.object({
    model: z.string().min(1).max(MAX_MODEL_ID_CHARS),
});

function getUserId(req: Request): string | null {
    if (!req.user) return null;
    if ('userId' in req.user && typeof (req.user as { userId?: unknown }).userId === 'string') {
        return (req.user as { userId: string }).userId;
    }
    if ('id' in req.user) return String(req.user.id);
    return null;
}

function parseAssignableRole(value: string): ModelRole | null {
    return (USER_ASSIGNABLE_MODEL_ROLES as readonly string[]).includes(value)
        ? (value as ModelRole)
        : null;
}

/** 외부 fullId 배정 검증 — 실패 사유 문자열 반환 (통과 시 null) */
async function validateExternalAssignment(userId: string, fullId: string): Promise<string | null> {
    const idx = fullId.indexOf(':');
    const providerId = fullId.slice(0, idx);
    const modelId = fullId.slice(idx + 1);
    if (!modelId) return `모델 id 가 비어 있습니다: '${fullId}'`;

    const entry = EXTERNAL_PROVIDER_CATALOG.find((p) => p.id === providerId);
    if (!entry) return `카탈로그에 없는 provider: '${providerId}'`;
    if (entry.sdkType !== 'openai-compatible') {
        return `provider '${providerId}' (sdkType=${entry.sdkType}) 는 역할 배정을 지원하지 않습니다`;
    }

    const keysRepo = new ExternalKeysRepository(getPool());
    const keyRow = await keysRepo.getByUserAndProvider(userId, providerId);
    if (!keyRow) return `'${providerId}' API 키를 먼저 등록하세요`;
    if (!keyRow.isActive) return `'${providerId}' API 키가 비활성 상태입니다`;
    return null;
}

/** 로컬 태그 배정 검증 — LLM 서버 무응답 시 fail-open (null 반환) */
async function validateLocalAssignment(tag: string): Promise<string | null> {
    try {
        const client = createClient();
        const { models } = await client.listModels();
        if (models.length > 0 && !models.some((m) => m.name === tag)) {
            return `LLM 서버에 없는 로컬 모델: '${tag}' (사용 가능: ${models.map((m) => m.name).join(', ')})`;
        }
    } catch (err) {
        log.warn(`로컬 모델 검증 스킵 (LLM 서버 무응답): ${err instanceof Error ? err.message : String(err)}`);
    }
    return null;
}

export function createUserModelRolesController(): Router {
    const router = Router();

    router.get('/', requireAuth, async (req, res) => {
        const userId = getUserId(req);
        if (!userId) { res.status(401).json(unauthorized()); return; }
        try {
            const repo = new UserModelRolesRepository(getPool());
            const mappings = await repo.listByUser(userId);
            res.json(success({
                mappings,
                assignableRoles: USER_ASSIGNABLE_MODEL_ROLES,
            }));
        } catch (err) {
            log.error('list 실패:', err);
            res.status(500).json(internalError('역할 매핑 목록 조회 실패'));
        }
    });

    router.put('/:role', requireAuth, validate(putSchema), async (req, res) => {
        const userId = getUserId(req);
        if (!userId) { res.status(401).json(unauthorized()); return; }
        const role = parseAssignableRole(req.params.role);
        if (!role) {
            res.status(400).json(badRequest(
                `배정 불가 role: '${req.params.role}' (허용: ${USER_ASSIGNABLE_MODEL_ROLES.join(', ')})`,
            ));
            return;
        }
        try {
            const { model } = req.body as z.infer<typeof putSchema>;
            const fullId = model.trim();

            let reason: string | null;
            if (isExternalFullId(fullId)) {
                reason = await validateExternalAssignment(userId, fullId);
            } else {
                const tag = toLocalModelTag(fullId);
                reason = tag ? await validateLocalAssignment(tag) : `해석 불가한 모델 id: '${fullId}'`;
            }
            if (reason) {
                res.status(400).json(badRequest(reason));
                return;
            }

            const repo = new UserModelRolesRepository(getPool());
            const mapping = await repo.upsert(userId, role, fullId);
            log.info(`역할 매핑 저장: userId=${userId} role=${role} model=${fullId}`);
            res.json(success({ mapping }));
        } catch (err) {
            log.error('upsert 실패:', err);
            res.status(500).json(internalError('역할 매핑 저장 실패'));
        }
    });

    router.delete('/:role', requireAuth, async (req, res) => {
        const userId = getUserId(req);
        if (!userId) { res.status(401).json(unauthorized()); return; }
        const role = parseAssignableRole(req.params.role);
        if (!role) {
            res.status(400).json(badRequest(`배정 불가 role: '${req.params.role}'`));
            return;
        }
        try {
            const repo = new UserModelRolesRepository(getPool());
            const deleted = await repo.delete(userId, role);
            if (!deleted) { res.status(404).json(notFound('매핑 없음')); return; }
            log.info(`역할 매핑 해제: userId=${userId} role=${role}`);
            res.json(success({ deleted: true }));
        } catch (err) {
            log.error('delete 실패:', err);
            res.status(500).json(internalError('역할 매핑 해제 실패'));
        }
    });

    return router;
}
