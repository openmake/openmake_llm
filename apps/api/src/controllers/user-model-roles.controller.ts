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
import { ModelRole, USER_ASSIGNABLE_MODEL_ROLES } from '../config/model-roles';
import { validateModelAssignment } from '../services/model-assignment-validation';
import { getAuditService } from '../services/AuditService';
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

/**
 * 배정 변경 감사 기록 — 2026-08-08 배정 전체 소실(0행) 사건에서 변경 이력이 없어
 * 원인 추적이 불가했던 갭 해소. previous 를 함께 남겨 소실 시 복원 근거로 쓴다.
 * (admin-model-roles.routes 의 auditChange 와 동일 관용구 — 실패는 응답에 영향 없음)
 */
async function auditChange(userId: string, action: string, details: Record<string, unknown>): Promise<void> {
    try {
        await getAuditService().logAudit({
            action,
            userId,
            resourceType: 'model_role',
            details,
        });
    } catch (err) {
        // 감사 실패가 배정 자체를 되돌리진 않지만, 조용히 삼키지 않고 details(previous 포함)와
        // 함께 남겨 '배정은 됐는데 기록은 없는' 추적 갭에서 최소한 애플리케이션 로그로 복원 가능하게 한다.
        log.error('배정 감사 기록 실패 (배정은 반영됨):', { action, details, err });
    }
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

            const reason = await validateModelAssignment(userId, fullId);
            if (reason) {
                res.status(400).json(badRequest(reason));
                return;
            }

            const repo = new UserModelRolesRepository(getPool());
            const { mapping, previous } = await repo.upsert(userId, role, fullId);
            log.info(`역할 매핑 저장: userId=${userId} role=${role} model=${fullId}`);
            await auditChange(userId, 'user_model_role_set', { role, model: fullId, previous });
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
            const { deleted, previous } = await repo.delete(userId, role);
            if (!deleted) { res.status(404).json(notFound('매핑 없음')); return; }
            log.info(`역할 매핑 해제: userId=${userId} role=${role}`);
            await auditChange(userId, 'user_model_role_unset', { role, previous });
            res.json(success({ deleted: true }));
        } catch (err) {
            log.error('delete 실패:', err);
            res.status(500).json(internalError('역할 매핑 해제 실패'));
        }
    });

    return router;
}
