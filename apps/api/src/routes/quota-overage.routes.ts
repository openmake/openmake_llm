/**
 * 쿼터 초과 요청·추가 한도 REST (F25 PR-3b, 135).
 *   사용자: GET /api/usage/overage-requests · POST /api/usage/overage-requests { window, requestedAmount, reason? } · GET /api/usage/grants
 *   관리자: GET /api/admin/quota-overage?status= · POST /api/admin/quota-overage/:id/approve { amount? } · POST .../reject
 *           POST /api/admin/quota-grants { userId, window, bucket?, amount } (수동 부여)
 *             + QUOTA_ORG_GRANTS_ENABLED: { subjectType:'org', orgId } 조직 grant · { dimension:'cost_micros' } 비용 grant(둘 다 월 버킷)
 *             GET /api/admin/quota-grants?orgId= (조직 grant 목록, 같은 플래그)
 *           GET /api/admin/quota-features (F25 잔여 플래그 값 — 화면 표시용)
 *           QUOTA_USER_OVERRIDES_ENABLED: GET /api/admin/quota-overrides · PUT/DELETE /api/admin/quota-overrides/:userId
 *             (꺼져 있으면 404 — 종전 표면 그대로)
 * 승인은 quota_grants(kind approval, source=요청 id) 삽입 + 감사 `quota.overage_decided`, 캐시 무효화.
 * @module routes/quota-overage
 */
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { requireAuth, requireAdmin } from '../auth/middleware';
import { asyncHandler } from '../utils/error-handler';
import { success, badRequest, notFound } from '../utils/api-response';
import { validate } from '../middlewares/validation';
import { getPool } from '../data/models/unified-database';
import { QuotaGrantRepository } from '../data/repositories/quota-grant-repository';
import { currentBucket } from '../llm/user-quota';
import { clearQuotaGrantCache, clearSubjectGrantCache, ensureOverageRequest } from '../services/cost/quota-grants';
import { clearQuotaOverrideCache } from '../services/cost/quota-overrides';
import { UserQuotaOverrideRepository } from '../data/repositories/user-quota-override-repository';
import { quotaOrgGrantsEnabled, quotaUserOverridesEnabled, quotaOrgBucketEnabled, storageGeneratedDailySnapshotEnabled } from '../config/quota-extensions';
import { getAuditService } from '../services/AuditService';

const repo = () => new QuotaGrantRepository(getPool());
const windowSchema = z.enum(['hourly', 'weekly', 'monthly']);
const userId = (req: Request): string => String(req.user!.id);

// ── 사용자 ──
export const usageQuotaRouter = Router();
usageQuotaRouter.use(requireAuth);

usageQuotaRouter.get('/overage-requests', asyncHandler(async (req: Request, res: Response) => {
    res.json(success({ requests: await repo().listOverages(undefined, 50, userId(req)) }));
}));

const createSchema = z.object({ window: windowSchema, requestedAmount: z.number().int().min(1).max(1_000_000_000), reason: z.string().trim().max(500).optional() });
usageQuotaRouter.post('/overage-requests', validate(createSchema), asyncHandler(async (req: Request, res: Response) => {
    const b = req.body as z.infer<typeof createSchema>;
    const id = await ensureOverageRequest(userId(req), b.window, currentBucket(b.window, Date.now()), b.requestedAmount, b.reason ?? null, false);
    if (!id) return res.status(500).json(badRequest('요청을 만들지 못했습니다.'));
    res.status(201).json(success({ request: await repo().getOverage(id) }));
}));

usageQuotaRouter.get('/grants', asyncHandler(async (req: Request, res: Response) => {
    res.json(success({ grants: await repo().listUserGrants(userId(req)) }));
}));

// ── 관리자 ──
export const adminQuotaOverageRouter = Router();
adminQuotaOverageRouter.use(requireAuth, requireAdmin);

adminQuotaOverageRouter.get('/quota-overage', asyncHandler(async (req: Request, res: Response) => {
    const status = typeof req.query.status === 'string' ? req.query.status : 'pending';
    res.json(success({ requests: await repo().listOverages(status === 'all' ? undefined : status, 200) }));
}));

const approveSchema = z.object({ amount: z.number().int().min(1).max(1_000_000_000).optional() });
adminQuotaOverageRouter.post('/quota-overage/:id/approve', validate(approveSchema), asyncHandler(async (req: Request, res: Response) => {
    const r = repo();
    const existing = await r.getOverage(req.params.id);
    if (!existing) return res.status(404).json(notFound('요청이 없습니다.'));
    const amount = (req.body as z.infer<typeof approveSchema>).amount ?? Number(existing.requested_amount);
    const decided = await r.decideOverage(existing.id, 'approved', userId(req), amount);
    if (!decided) return res.status(409).json(badRequest('이미 처리된 요청입니다.'));
    await r.insertIfAbsent({ userId: existing.user_id, window: existing.window, bucket: existing.bucket, amount, kind: 'approval', sourceId: existing.id, createdBy: userId(req) });
    clearQuotaGrantCache(existing.user_id);
    await getAuditService().logAudit({ action: 'quota.overage_decided', userId: userId(req), resourceType: 'quota_overage', resourceId: existing.id, details: { decision: 'approved', amount, targetUserId: existing.user_id } });
    res.json(success({ request: decided }));
}));

adminQuotaOverageRouter.post('/quota-overage/:id/reject', asyncHandler(async (req: Request, res: Response) => {
    const decided = await repo().decideOverage(req.params.id, 'rejected', userId(req), null);
    if (!decided) return res.status(404).json(notFound('대기 중인 요청이 아닙니다.'));
    await getAuditService().logAudit({ action: 'quota.overage_decided', userId: userId(req), resourceType: 'quota_overage', resourceId: decided.id, details: { decision: 'rejected', targetUserId: decided.user_id } });
    res.json(success({ request: decided }));
}));

const manualSchema = z.object({
    userId: z.string().min(1).optional(),
    orgId: z.string().min(1).optional(),
    subjectType: z.enum(['user', 'org']).optional(),
    dimension: z.enum(['tokens', 'cost_micros']).optional(),
    window: windowSchema,
    bucket: z.string().min(1).max(32).optional(),
    amount: z.number().int().min(1).max(1_000_000_000_000),
});
adminQuotaOverageRouter.post('/quota-grants', validate(manualSchema), asyncHandler(async (req: Request, res: Response) => {
    const b = req.body as z.infer<typeof manualSchema>;
    const subjectType = b.subjectType ?? 'user';
    const dimension = b.dimension ?? 'tokens';
    const extended = subjectType !== 'user' || dimension !== 'tokens';
    if (extended && !quotaOrgGrantsEnabled()) return res.status(400).json(badRequest('조직·비용 grant 는 QUOTA_ORG_GRANTS_ENABLED 를 켜야 합니다.'));
    const subjectId = subjectType === 'org' ? b.orgId : b.userId;
    if (!subjectId) return res.status(400).json(badRequest(subjectType === 'org' ? 'orgId 가 필요합니다.' : 'userId 가 필요합니다.'));
    // 조직 예산·비용 예산은 월 단위라 그 grant 도 월 버킷만 의미가 있다
    if (extended && b.window !== 'monthly') return res.status(400).json(badRequest('조직·비용 grant 는 window=monthly 만 받습니다.'));
    if (b.amount > 1_000_000_000 && dimension === 'tokens') return res.status(400).json(badRequest('토큰 grant 는 10억 이하입니다.'));
    const bucket = b.bucket ?? currentBucket(b.window, Date.now());
    const r = repo();
    const inserted = extended
        ? await r.insertGrantIfAbsent({ subjectType, subjectId, dimension, window: b.window, bucket, amount: b.amount, kind: 'manual', sourceId: `${Date.now()}`, createdBy: userId(req) })
        : await r.insertIfAbsent({ userId: subjectId, window: b.window, bucket, amount: b.amount, kind: 'manual', sourceId: `${Date.now()}`, createdBy: userId(req) });
    if (extended) clearSubjectGrantCache(subjectType, subjectId); else clearQuotaGrantCache(subjectId);
    await getAuditService().logAudit({ action: 'quota.grant_manual', userId: userId(req), resourceType: 'quota_grant', resourceId: subjectId,
        details: { window: b.window, bucket, amount: b.amount, ...(extended ? { subjectType, dimension } : {}) } });
    res.status(201).json(success({ inserted, bucket }));
}));

adminQuotaOverageRouter.get('/quota-grants', asyncHandler(async (req: Request, res: Response) => {
    if (!quotaOrgGrantsEnabled()) return res.status(404).json(notFound('조직 grant 목록이 꺼져 있습니다.'));
    const orgId = typeof req.query.orgId === 'string' ? req.query.orgId : '';
    if (!orgId) return res.status(400).json(badRequest('orgId 가 필요합니다.'));
    res.json(success({ grants: await repo().listOrgGrants(orgId, 100) }));
}));

// 관리자 화면이 켜진 F25 잔여 기능만 보이도록 — 플래그 값만(설정 자체는 /admin 시스템 설정)
adminQuotaOverageRouter.get('/quota-features', (_req: Request, res: Response) => {
    res.json(success({
        userOverrides: quotaUserOverridesEnabled(), orgGrants: quotaOrgGrantsEnabled(),
        orgBucket: quotaOrgBucketEnabled(), storageDailySnapshot: storageGeneratedDailySnapshotEnabled(),
    }));
});

// ── 사용자별 한도 덮어쓰기 (213, QUOTA_USER_OVERRIDES_ENABLED) ──
const overrideRepo = () => new UserQuotaOverrideRepository(getPool());
const limitField = z.number().int().min(0).max(1_000_000_000_000).nullable();
const overrideSchema = z.object({
    hourlyTokenLimit: limitField,
    weeklyTokenLimit: limitField,
    monthlyCostBudgetMicros: limitField,
    reason: z.string().trim().max(500).nullable().optional(),
}).strict();

adminQuotaOverageRouter.use('/quota-overrides', (req: Request, res: Response, next) => {
    if (!quotaUserOverridesEnabled()) return res.status(404).json(notFound('사용자별 한도 덮어쓰기가 꺼져 있습니다.'));
    next();
});

adminQuotaOverageRouter.get('/quota-overrides', asyncHandler(async (_req: Request, res: Response) => {
    res.json(success({ overrides: await overrideRepo().list(500) }));
}));

adminQuotaOverageRouter.put('/quota-overrides/:userId', validate(overrideSchema), asyncHandler(async (req: Request, res: Response) => {
    const b = req.body as z.infer<typeof overrideSchema>;
    const target = req.params.userId;
    const r = overrideRepo();
    if (!(await r.userExists(target))) return res.status(404).json(notFound('사용자가 없습니다.'));
    const row = await r.upsert(target, {
        hourlyTokenLimit: b.hourlyTokenLimit, weeklyTokenLimit: b.weeklyTokenLimit,
        monthlyCostBudgetMicros: b.monthlyCostBudgetMicros, reason: b.reason ?? null,
    }, userId(req));
    clearQuotaOverrideCache(target);
    await getAuditService().logAudit({ action: 'quota.override_changed', userId: userId(req), resourceType: 'user_quota_override', resourceId: target,
        details: { hourlyTokenLimit: b.hourlyTokenLimit, weeklyTokenLimit: b.weeklyTokenLimit, monthlyCostBudgetMicros: b.monthlyCostBudgetMicros } });
    res.json(success({ override: row }));
}));

adminQuotaOverageRouter.delete('/quota-overrides/:userId', asyncHandler(async (req: Request, res: Response) => {
    const target = req.params.userId;
    const removed = await overrideRepo().remove(target);
    if (!removed) return res.status(404).json(notFound('덮어쓰기가 없습니다.'));
    clearQuotaOverrideCache(target);
    await getAuditService().logAudit({ action: 'quota.override_changed', userId: userId(req), resourceType: 'user_quota_override', resourceId: target, details: { removed: true } });
    res.json(success({ removed }));
}));
