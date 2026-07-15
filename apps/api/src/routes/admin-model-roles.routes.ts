/**
 * @module routes/admin-model-roles
 * @description 전역 역할→모델 매핑(L3) + 서버 공용 외부 키 관리 — admin 전용.
 *
 * Role-based Orchestration 2차 Phase B.
 *
 * 엔드포인트 (모두 requireAuth + requireAdmin):
 *   GET    /api/admin/model-roles                     — 전역 DB 매핑 + env 폴백 현황
 *   PUT    /api/admin/model-roles/:role               — 배정 (body: { model })
 *   DELETE /api/admin/model-roles/:role               — 해제 (env/default 폴백 복귀)
 *   GET    /api/admin/server-external-keys            — 서버 키 목록 (키 값 미노출)
 *   PUT    /api/admin/server-external-keys/:providerId — 등록/갱신 (daily 상한 필수)
 *   DELETE /api/admin/server-external-keys/:providerId
 *
 * 전역 매핑의 외부 fullId 는 해당 provider 의 서버 공용 키 등록·활성이 전제(400).
 * 변경은 logAudit 기록. resolver 캐시(60s)는 같은 프로세스 변경 시 즉시 무효화.
 */
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { requireAuth, requireAdmin } from '../auth';
import { validate } from '../middlewares/validation';
import { asyncHandler } from '../utils/error-handler';
import { success, badRequest, notFound } from '../utils/api-response';
import { getPool } from '../data/models/unified-database';
import { GlobalModelRolesRepository } from '../data/repositories/global-model-roles-repo';
import { ServerExternalKeysRepository } from '../data/repositories/server-external-keys-repo';
import { clearGlobalRolesCache } from '../services/model-role-resolver';
import {
    ModelRole,
    MODEL_ROLES,
    getAllRoleModels,
    isExternalFullId,
    toLocalModelTag,
} from '../config/model-roles';
import { EXTERNAL_PROVIDER_CATALOG } from '../config/external-providers';
import { getAuditService } from '../services/AuditService';
import { createLogger } from '../utils/logger';

const logger = createLogger('AdminModelRolesRoutes');

const MAX_MODEL_ID_CHARS = 200;

const putRoleSchema = z.object({
    model: z.string().min(1).max(MAX_MODEL_ID_CHARS),
});

const putServerKeySchema = z.object({
    apiKey: z.string().min(8).max(500),
    baseUrl: z.url().max(500).optional(),
    dailyTokenLimit: z.number().int().min(0),
    monthlyTokenLimit: z.number().int().min(0).nullable().optional(),
});

function parseRole(value: string): ModelRole | null {
    return (MODEL_ROLES as readonly string[]).includes(value) ? (value as ModelRole) : null;
}

function adminUserId(req: Request): string | undefined {
    return req.user?.id !== undefined ? String(req.user.id) : undefined;
}

function auditChange(req: Request, action: string, details: Record<string, unknown>): void {
    void getAuditService().logAudit({
        action,
        userId: adminUserId(req),
        resourceType: 'model_role',
        details,
    }).catch(() => { /* audit 실패는 응답에 영향 없음 */ });
}

export const adminModelRolesRouter = Router();
adminModelRolesRouter.use(requireAuth, requireAdmin);

/* ── 전역 역할 매핑 ─────────────────────────────────────── */

adminModelRolesRouter.get('/model-roles', asyncHandler(async (_req: Request, res: Response) => {
    const repo = new GlobalModelRolesRepository(getPool());
    const mappings = await repo.list();
    res.json(success({
        mappings,
        roles: MODEL_ROLES,
        // env(L1)/default 폴백 현황 — DB 매핑이 없을 때 실제 적용되는 값
        envFallback: getAllRoleModels(),
    }));
}));

adminModelRolesRouter.put('/model-roles/:role', validate(putRoleSchema), asyncHandler(async (req: Request, res: Response) => {
    const role = parseRole(req.params.role);
    if (!role) {
        res.status(400).json(badRequest(`알 수 없는 role: '${req.params.role}' (허용: ${MODEL_ROLES.join(', ')})`));
        return;
    }
    const fullId = (req.body as z.infer<typeof putRoleSchema>).model.trim();

    if (isExternalFullId(fullId)) {
        const providerId = fullId.slice(0, fullId.indexOf(':'));
        const entry = EXTERNAL_PROVIDER_CATALOG.find((p) => p.id === providerId);
        if (!entry || entry.sdkType !== 'openai-compatible') {
            res.status(400).json(badRequest(`provider '${providerId}' 는 역할 배정을 지원하지 않습니다`));
            return;
        }
        const serverKey = await new ServerExternalKeysRepository(getPool()).get(providerId);
        if (!serverKey || !serverKey.isActive) {
            res.status(400).json(badRequest(`'${providerId}' 서버 공용 키를 먼저 등록하세요 (전역 매핑은 BYOK 가 아닌 서버 키로 실행됩니다)`));
            return;
        }
    } else if (!toLocalModelTag(fullId)) {
        res.status(400).json(badRequest(`해석 불가한 모델 id: '${fullId}'`));
        return;
    }

    const repo = new GlobalModelRolesRepository(getPool());
    const mapping = await repo.upsert(role, fullId);
    clearGlobalRolesCache();
    auditChange(req, 'admin_global_model_role_set', { role, model: fullId });
    logger.info(`전역 역할 매핑 저장: role=${role} model=${fullId}`);
    res.json(success({ mapping }));
}));

adminModelRolesRouter.delete('/model-roles/:role', asyncHandler(async (req: Request, res: Response) => {
    const role = parseRole(req.params.role);
    if (!role) {
        res.status(400).json(badRequest(`알 수 없는 role: '${req.params.role}'`));
        return;
    }
    const repo = new GlobalModelRolesRepository(getPool());
    const deleted = await repo.delete(role);
    if (!deleted) {
        res.status(404).json(notFound('매핑 없음'));
        return;
    }
    clearGlobalRolesCache();
    auditChange(req, 'admin_global_model_role_unset', { role });
    res.json(success({ deleted: true }));
}));

/* ── 서버 공용 외부 키 ──────────────────────────────────── */

adminModelRolesRouter.get('/server-external-keys', asyncHandler(async (_req: Request, res: Response) => {
    const repo = new ServerExternalKeysRepository(getPool());
    const keys = await repo.list();
    res.json(success({
        keys,
        // 등록 가능한 provider 카탈로그 (openai-compatible 만 role 실행 지원)
        providers: EXTERNAL_PROVIDER_CATALOG
            .filter((p) => p.sdkType === 'openai-compatible')
            .map((p) => ({ id: p.id, displayName: p.displayName, defaultBaseUrl: p.defaultBaseUrl })),
    }));
}));

adminModelRolesRouter.put('/server-external-keys/:providerId', validate(putServerKeySchema), asyncHandler(async (req: Request, res: Response) => {
    const providerId = req.params.providerId;
    const entry = EXTERNAL_PROVIDER_CATALOG.find((p) => p.id === providerId);
    if (!entry || entry.sdkType !== 'openai-compatible') {
        res.status(400).json(badRequest(`카탈로그에 없는 provider: '${providerId}' (openai-compatible 만 지원)`));
        return;
    }
    const body = req.body as z.infer<typeof putServerKeySchema>;
    const repo = new ServerExternalKeysRepository(getPool());
    const row = await repo.upsert({
        providerId,
        apiKey: body.apiKey,
        baseUrl: body.baseUrl ?? null,
        dailyTokenLimit: body.dailyTokenLimit,
        monthlyTokenLimit: body.monthlyTokenLimit ?? null,
    });
    auditChange(req, 'admin_server_external_key_set', {
        providerId, dailyTokenLimit: body.dailyTokenLimit, monthlyTokenLimit: body.monthlyTokenLimit ?? null,
    });
    logger.info(`서버 공용 키 등록: provider=${providerId} daily=${body.dailyTokenLimit}`);
    res.json(success({ key: row }));
}));

adminModelRolesRouter.delete('/server-external-keys/:providerId', asyncHandler(async (req: Request, res: Response) => {
    const repo = new ServerExternalKeysRepository(getPool());
    const deleted = await repo.delete(req.params.providerId);
    if (!deleted) {
        res.status(404).json(notFound('서버 키 없음'));
        return;
    }
    auditChange(req, 'admin_server_external_key_delete', { providerId: req.params.providerId });
    res.json(success({ deleted: true }));
}));
