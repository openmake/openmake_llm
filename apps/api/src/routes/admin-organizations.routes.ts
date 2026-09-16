/**
 * 관리자 조직 API (Control Plane 기초, 127) — 조직·멤버·월 토큰 예산.
 *
 * 엔드포인트 (모두 requireAuth + requireAdmin, /api/admin 전역 adminLimiter 적용):
 *   GET    /api/admin/organizations                       목록
 *   POST   /api/admin/organizations                       생성 { name, slug, monthlyTokenBudget? }
 *   PATCH  /api/admin/organizations/:id                   수정 { name?, monthlyTokenBudget? (null=무제한) }
 *   DELETE /api/admin/organizations/:id                   삭제(멤버십 CASCADE)
 *   GET    /api/admin/organizations/:id/members           멤버 목록
 *   PUT    /api/admin/organizations/:id/members/:userId   멤버 추가/역할 변경 { role }
 *   DELETE /api/admin/organizations/:id/members/:userId   멤버 제거
 * 예산·멤버 변경은 쿼터 캐시(user-quota)를 비워 즉시 반영한다.
 *
 * @module routes/admin-organizations
 */
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import { requireAuth, requireAdmin } from '../auth';
import { validate } from '../middlewares/validation';
import { asyncHandler } from '../utils/error-handler';
import { success, badRequest, notFound } from '../utils/api-response';
import { getPool } from '../data/models/unified-database';
import { OrganizationRepository } from '../data/repositories/organization-repository';
import { clearOrgMembershipCache } from '../services/org/membership-cache';

const slugSchema = z.string().trim().min(2).max(64).regex(/^[a-z0-9][a-z0-9-]*$/, 'slug 는 소문자·숫자·하이픈');
const budgetSchema = z.number().int().min(1).max(1_000_000_000_000).nullable();
const createSchema = z.object({ name: z.string().trim().min(1).max(200), slug: slugSchema, monthlyTokenBudget: budgetSchema.optional() });
const patchSchema = z.object({ name: z.string().trim().min(1).max(200).optional(), monthlyTokenBudget: budgetSchema.optional() });
const memberSchema = z.object({ role: z.enum(['owner', 'admin', 'member']).default('member') });

export const adminOrganizationsRouter = Router();
adminOrganizationsRouter.use('/organizations', requireAuth, requireAdmin);
const repo = (): OrganizationRepository => new OrganizationRepository(getPool());

adminOrganizationsRouter.get('/organizations', asyncHandler(async (_req: Request, res: Response) => {
    res.json(success({ organizations: await repo().list() }));
}));

adminOrganizationsRouter.post('/organizations', validate(createSchema), asyncHandler(async (req: Request, res: Response) => {
    const body = req.body as z.infer<typeof createSchema>;
    try {
        const org = await repo().create(randomUUID(), body.name, body.slug, String(req.user!.id), body.monthlyTokenBudget ?? null);
        res.status(201).json(success({ organization: org }));
    } catch (e) {
        if ((e as { code?: string }).code === '23505') return res.status(400).json(badRequest('이미 있는 slug 입니다.'));
        throw e;
    }
}));

adminOrganizationsRouter.patch('/organizations/:id', validate(patchSchema), asyncHandler(async (req: Request, res: Response) => {
    const org = await repo().update(req.params.id, req.body as z.infer<typeof patchSchema>);
    if (!org) return res.status(404).json(notFound('조직을 찾을 수 없습니다.'));
    clearOrgMembershipCache();
    res.json(success({ organization: org }));
}));

adminOrganizationsRouter.delete('/organizations/:id', asyncHandler(async (req: Request, res: Response) => {
    if (!(await repo().remove(req.params.id))) return res.status(404).json(notFound('조직을 찾을 수 없습니다.'));
    clearOrgMembershipCache();
    res.json(success({ deleted: true }));
}));

adminOrganizationsRouter.get('/organizations/:id/members', asyncHandler(async (req: Request, res: Response) => {
    if (!(await repo().get(req.params.id))) return res.status(404).json(notFound('조직을 찾을 수 없습니다.'));
    res.json(success({ members: await repo().listMembers(req.params.id) }));
}));

adminOrganizationsRouter.put('/organizations/:id/members/:userId', validate(memberSchema), asyncHandler(async (req: Request, res: Response) => {
    if (!(await repo().get(req.params.id))) return res.status(404).json(notFound('조직을 찾을 수 없습니다.'));
    try {
        const member = await repo().upsertMember(req.params.id, req.params.userId, (req.body as z.infer<typeof memberSchema>).role);
        clearOrgMembershipCache();
        res.json(success({ member }));
    } catch (e) {
        if ((e as { code?: string }).code === '23503') return res.status(400).json(badRequest('존재하지 않는 사용자입니다.'));
        throw e;
    }
}));

adminOrganizationsRouter.delete('/organizations/:id/members/:userId', asyncHandler(async (req: Request, res: Response) => {
    if (!(await repo().removeMember(req.params.id, req.params.userId))) return res.status(404).json(notFound('멤버가 아닙니다.'));
    clearOrgMembershipCache();
    res.json(success({ removed: true }));
}));
