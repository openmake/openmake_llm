/**
 * 조직 정책 REST (F22 Phase C-2, 129).
 *
 *   GET    /api/organizations/:id/policies          — 조직 owner/admin 또는 시스템 admin
 *   PUT    /api/organizations/:id/policies/:key     — body { value } (registry 검증)
 *   DELETE /api/organizations/:id/policies/:key
 *   GET    /api/admin/organizations/:id/policies    — 시스템 admin 전용 별칭(관리 콘솔)
 *
 * 허용 키·검증은 config/org-policy-registry.ts, 저장 후 캐시 무효화(effective-policy). 변경은 감사 로그
 * `org.policy_changed`(AuditService 가 알림으로 승격).
 *
 * @module routes/organization-policies
 */
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { requireAuth, requireAdmin } from '../auth/middleware';
import { asyncHandler, AuthorizationError } from '../utils/error-handler';
import { success, badRequest, notFound } from '../utils/api-response';
import { getPool } from '../data/models/unified-database';
import { OrganizationRepository } from '../data/repositories/organization-repository';
import { OrganizationPolicyRepository } from '../data/repositories/organization-policy-repository';
import { isOrgPolicyKey, ORG_POLICY_SCHEMAS } from '../config/org-policy-registry';
import { membershipsFor } from '../services/org/membership-cache';
import { clearOrgPolicyCache } from '../services/org/effective-policy';
import { getAuditService } from '../services/AuditService';
import { PolicyHistoryRepository } from '../data/repositories/policy-history-repository';
import { createLogger } from '../utils/logger';

const logger = createLogger('OrgPolicies');
const historyRepo = () => new PolicyHistoryRepository(getPool());

/** 이력(130) 기록 — 실패는 경고만. */
async function recordHistory(orgId: string, key: string, oldValue: unknown, newValue: unknown, actor: string): Promise<void> {
    try { await historyRepo().recordOrgPolicy(orgId, key, oldValue, newValue, actor); }
    catch (err) { logger.warn(`조직 정책 이력 기록 실패 (변경은 반영됨): ${orgId}/${key}`, err); }
}

const orgRepo = () => new OrganizationRepository(getPool());
const policyRepo = () => new OrganizationPolicyRepository(getPool());

/** 조직 owner/admin 또는 시스템 admin 만 — 그 외 403. */
async function assertOrgAdmin(req: Request, orgId: string): Promise<void> {
    if (req.user!.role === 'admin') return;
    const list = await membershipsFor(String(req.user!.id));
    const m = list.find((x) => x.orgId === orgId);
    if (!m || (m.role !== 'owner' && m.role !== 'admin')) throw new AuthorizationError('조직 관리자만 정책을 변경할 수 있습니다');
}

const putSchema = z.object({ value: z.unknown() });

function attach(router: Router, prefix: string, gate: 'admin' | 'org'): void {
    const guard = gate === 'admin' ? [requireAuth, requireAdmin] : [requireAuth];

    router.get(`${prefix}/:id/policies`, ...guard, asyncHandler(async (req: Request, res: Response) => {
        if (!(await orgRepo().get(req.params.id))) return res.status(404).json(notFound('조직을 찾을 수 없습니다.'));
        if (gate === 'org') await assertOrgAdmin(req, req.params.id);
        res.json(success({ policies: await policyRepo().list(req.params.id), keys: Object.keys(ORG_POLICY_SCHEMAS) }));
    }));

    router.get(`${prefix}/:id/policies/history`, ...guard, asyncHandler(async (req: Request, res: Response) => {
        if (!(await orgRepo().get(req.params.id))) return res.status(404).json(notFound('조직을 찾을 수 없습니다.'));
        if (gate === 'org') await assertOrgAdmin(req, req.params.id);
        const limit = Math.min(Math.max(parseInt(String(req.query.limit ?? '100'), 10) || 100, 1), 500);
        res.json(success({ history: await historyRepo().listOrgPolicies(req.params.id, limit) }));
    }));

    router.put(`${prefix}/:id/policies/:key`, ...guard, asyncHandler(async (req: Request, res: Response) => {
        const { id, key } = req.params;
        if (!isOrgPolicyKey(key)) return res.status(400).json(badRequest(`허용되지 않은 정책 키: ${key}`));
        if (!(await orgRepo().get(id))) return res.status(404).json(notFound('조직을 찾을 수 없습니다.'));
        if (gate === 'org') await assertOrgAdmin(req, id);
        const body = putSchema.safeParse(req.body);
        const parsed = body.success ? ORG_POLICY_SCHEMAS[key].safeParse(body.data.value) : null;
        if (!parsed || !parsed.success) return res.status(400).json(badRequest('정책 값이 형식에 맞지 않습니다.'));
        const previous = (await policyRepo().list(id)).find((r) => r.key === key)?.value ?? null;
        const row = await policyRepo().upsert(id, key, parsed.data, String(req.user!.id));
        clearOrgPolicyCache(id);
        await recordHistory(id, key, previous, parsed.data, String(req.user!.id));
        await getAuditService().logAudit({ action: 'org.policy_changed', userId: String(req.user!.id), resourceType: 'organization', resourceId: id, details: { key, value: parsed.data } });
        res.json(success({ policy: row }));
    }));

    router.delete(`${prefix}/:id/policies/:key`, ...guard, asyncHandler(async (req: Request, res: Response) => {
        const { id, key } = req.params;
        if (!isOrgPolicyKey(key)) return res.status(400).json(badRequest(`허용되지 않은 정책 키: ${key}`));
        if (gate === 'org') await assertOrgAdmin(req, id);
        const previous = (await policyRepo().list(id)).find((r) => r.key === key)?.value ?? null;
        const removed = await policyRepo().remove(id, key);
        if (!removed) return res.status(404).json(notFound('정책이 없습니다.'));
        clearOrgPolicyCache(id);
        await recordHistory(id, key, previous, null, String(req.user!.id));
        await getAuditService().logAudit({ action: 'org.policy_changed', userId: String(req.user!.id), resourceType: 'organization', resourceId: id, details: { key, value: null } });
        res.json(success({ removed: true }));
    }));
}

/** /api/organizations — 조직 관리자 자가 서비스 */
export const organizationPoliciesRouter = Router();
attach(organizationPoliciesRouter, '', 'org');

/** GET /api/organizations/:id/members — 멤버 목록(같은 조직 멤버 누구나, 승인 이관 대상 선택용 · 138). */
organizationPoliciesRouter.get('/:id/members', requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const list = await membershipsFor(String(req.user!.id));
    if (req.user!.role !== 'admin' && !list.some((m) => m.orgId === req.params.id)) throw new AuthorizationError('조직 멤버만 조회할 수 있습니다');
    res.json(success({ members: await orgRepo().listMembers(req.params.id) }));
}));

/** /api/admin/organizations — 시스템 관리자 */
export const adminOrganizationPoliciesRouter = Router();
attach(adminOrganizationPoliciesRouter, '/organizations', 'admin');
