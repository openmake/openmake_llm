/**
 * 쿼터 초과 요청·추가 한도 REST (F25 PR-3b, 135).
 *   사용자: GET /api/usage/overage-requests · POST /api/usage/overage-requests { window, requestedAmount, reason? } · GET /api/usage/grants
 *   관리자: GET /api/admin/quota-overage?status= · POST /api/admin/quota-overage/:id/approve { amount? } · POST .../reject
 *           POST /api/admin/quota-grants { userId, window, bucket?, amount } (수동 부여)
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
import { clearQuotaGrantCache, ensureOverageRequest } from '../services/cost/quota-grants';
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

const manualSchema = z.object({ userId: z.string().min(1), window: windowSchema, bucket: z.string().min(1).max(32).optional(), amount: z.number().int().min(1).max(1_000_000_000) });
adminQuotaOverageRouter.post('/quota-grants', validate(manualSchema), asyncHandler(async (req: Request, res: Response) => {
    const b = req.body as z.infer<typeof manualSchema>;
    const bucket = b.bucket ?? currentBucket(b.window, Date.now());
    const inserted = await repo().insertIfAbsent({ userId: b.userId, window: b.window, bucket, amount: b.amount, kind: 'manual', sourceId: `${Date.now()}`, createdBy: userId(req) });
    clearQuotaGrantCache(b.userId);
    await getAuditService().logAudit({ action: 'quota.grant_manual', userId: userId(req), resourceType: 'quota_grant', resourceId: b.userId, details: { window: b.window, bucket, amount: b.amount } });
    res.status(201).json(success({ inserted, bucket }));
}));
