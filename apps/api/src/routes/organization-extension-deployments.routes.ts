/**
 * 조직 확장 배포 모드·그룹 REST (마켓플레이스 계획 v3.7 §8-1, 208·209). `/api/organizations` 아래에 붙는다.
 *
 *   GET    /:id/extension-deployments                              — 조직 공개 항목 + 기본값·그룹 덮어쓰기·설치 수, 그룹·멤버(이름) 목록
 *   PUT    /:id/extension-deployments/:extensionId                 — body { mode } 항목 기본값
 *   PUT    /:id/extension-deployments/:extensionId/groups/:groupId — body { mode | null } 그룹 덮어쓰기(null = 지움)
 *   GET    /:id/groups                                             — 그룹 + 멤버 id
 *   POST   /:id/groups                                             — body { name }
 *   PATCH  /:id/groups/:groupId                                    — body { name }
 *   DELETE /:id/groups/:groupId
 *   PUT    /:id/groups/:groupId/members/:userId                    — 조직 멤버만(아니면 400)
 *   DELETE /:id/groups/:groupId/members/:userId
 *
 * 판정 순서: 플래그(EXTENSION_ORG_DEPLOYMENT_MODES_ENABLED, 꺼짐 = 404 — 라우트가 없는 것과 같다) → 조직 존재(404) →
 * 권한(security/authorize `org_extension_deployment` — 조직 owner/admin·시스템 admin, 그 외 403) →
 * 대상 소속(다른 조직의 항목·그룹 = 403, 없음 = 404).
 * 저장 뒤 그 조직 멤버의 조정을 fire-and-forget 으로 돌린다(다음 tick 도 다시 맞춘다).
 *
 * @module routes/organization-extension-deployments
 */
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import { requireAuth } from '../auth/middleware';
import { asyncHandler, AuthorizationError } from '../utils/error-handler';
import { success, badRequest, notFound, conflict } from '../utils/api-response';
import { getPool } from '../data/models/unified-database';
import { OrganizationRepository } from '../data/repositories/organization-repository';
import { ExtensionOrgDeploymentRepository } from '../data/repositories/extension-org-deployment-repository';
import { membershipsFor } from '../services/org/membership-cache';
import { assertCanAccess } from '../security/authorize';
import type { ResourceAction } from '../config/resource-policy';
import {
    DEPLOYMENT_MODES,
    EXTENSION_ORG_DEPLOYMENT_LIMITS,
    extensionOrgDeploymentModesEnabled,
} from '../config/extension-org-deployment';
import { triggerOrgReconcile } from '../services/extensions/org-deployment';
import { getAuditService } from '../services/AuditService';
import { createLogger } from '../utils/logger';

const logger = createLogger('OrgExtensionDeployments');

const modeSchema = z.object({ mode: z.enum(DEPLOYMENT_MODES) });
const groupModeSchema = z.object({ mode: z.enum(DEPLOYMENT_MODES).nullable() });
const groupNameSchema = z.object({ name: z.string().trim().min(1).max(EXTENSION_ORG_DEPLOYMENT_LIMITS.GROUP_NAME_MAX_CHARS) });

const orgRepo = () => new OrganizationRepository(getPool());
const repo = () => new ExtensionOrgDeploymentRepository(getPool());

/** 플래그 → 조직 존재 → 권한. 통과하면 true, 응답을 보냈으면 false */
async function gate(req: Request, res: Response, action: ResourceAction): Promise<boolean> {
    if (!extensionOrgDeploymentModesEnabled()) { res.status(404).json(notFound('조직 확장 배포 모드가 꺼져 있습니다')); return false; }
    const orgId = req.params.id;
    if (!(await orgRepo().get(orgId))) { res.status(404).json(notFound('조직을 찾을 수 없습니다.')); return false; }
    const userId = String(req.user!.id);
    // 판정 대상 조직 = 경로의 조직(활성 조직이 아니어도 그 조직의 역할로 판정한다 — 관리 화면은 조직을 골라 들어온다)
    const m = req.user!.role === 'admin' ? undefined : (await membershipsFor(userId)).find((x) => x.orgId === orgId);
    assertCanAccess('org_extension_deployment', action, { ownerId: null, orgId },
        { userId, role: req.user!.role, orgId: m?.orgId ?? null, orgRole: m?.role ?? null });
    return true;
}

/** 항목이 이 조직에 공개된 active 항목인지 — 없음 404, 다른 조직(또는 공개 해제) 403 */
async function assertItemInOrg(res: Response, orgId: string, extensionId: string): Promise<boolean> {
    const scope = await repo().getItemScope(extensionId);
    if (!scope) { res.status(404).json(notFound('확장을 찾을 수 없습니다.')); return false; }
    if (scope.status !== 'active' || scope.visibility !== 'organization' || scope.org_id !== orgId) {
        throw new AuthorizationError('이 조직에 공개된 확장이 아닙니다');
    }
    return true;
}

/** 그룹이 이 조직 것인지 — 없음 404, 다른 조직 403 */
async function assertGroupInOrg(res: Response, orgId: string, groupId: string): Promise<boolean> {
    const owner = await repo().getGroupOrg(groupId);
    if (!owner) { res.status(404).json(notFound('그룹을 찾을 수 없습니다.')); return false; }
    if (owner !== orgId) throw new AuthorizationError('이 조직의 그룹이 아닙니다');
    return true;
}

async function audit(req: Request, orgId: string, details: Record<string, unknown>): Promise<void> {
    try {
        await getAuditService().logAudit({
            action: 'org.extension_deployment_changed', userId: String(req.user!.id),
            resourceType: 'organization', resourceId: orgId, details,
        });
    } catch (e) {
        logger.warn(`감사 기록 실패 (변경은 반영됨): org=${orgId}`, e);
    }
}

export const organizationExtensionDeploymentsRouter = Router();
const r = organizationExtensionDeploymentsRouter;

r.get('/:id/extension-deployments', requireAuth, asyncHandler(async (req: Request, res: Response) => {
    if (!(await gate(req, res, 'read'))) return;
    const [items, groups, members] = await Promise.all([
        repo().listOrgItems(req.params.id), repo().listGroups(req.params.id), repo().listOrgMembers(req.params.id),
    ]);
    res.json(success({ items, groups, members, modes: DEPLOYMENT_MODES }));
}));

r.put('/:id/extension-deployments/:extensionId', requireAuth, asyncHandler(async (req: Request, res: Response) => {
    if (!(await gate(req, res, 'write'))) return;
    const body = modeSchema.safeParse(req.body);
    if (!body.success) return res.status(400).json(badRequest(`mode 는 ${DEPLOYMENT_MODES.join('|')} 중 하나입니다.`));
    const { id, extensionId } = req.params;
    if (!(await assertItemInOrg(res, id, extensionId))) return;
    await repo().setItemMode(extensionId, id, body.data.mode, String(req.user!.id));
    await audit(req, id, { extensionId, mode: body.data.mode });
    triggerOrgReconcile(id);
    res.json(success({ extensionId, mode: body.data.mode }));
}));

r.put('/:id/extension-deployments/:extensionId/groups/:groupId', requireAuth, asyncHandler(async (req: Request, res: Response) => {
    if (!(await gate(req, res, 'write'))) return;
    const body = groupModeSchema.safeParse(req.body);
    if (!body.success) return res.status(400).json(badRequest(`mode 는 ${DEPLOYMENT_MODES.join('|')} 또는 null 입니다.`));
    const { id, extensionId, groupId } = req.params;
    if (!(await assertItemInOrg(res, id, extensionId))) return;
    if (!(await assertGroupInOrg(res, id, groupId))) return;
    await repo().setGroupMode(extensionId, groupId, body.data.mode, String(req.user!.id));
    await audit(req, id, { extensionId, groupId, mode: body.data.mode });
    triggerOrgReconcile(id);
    res.json(success({ extensionId, groupId, mode: body.data.mode }));
}));

r.get('/:id/groups', requireAuth, asyncHandler(async (req: Request, res: Response) => {
    if (!(await gate(req, res, 'read'))) return;
    res.json(success({ groups: await repo().listGroups(req.params.id) }));
}));

r.post('/:id/groups', requireAuth, asyncHandler(async (req: Request, res: Response) => {
    if (!(await gate(req, res, 'write'))) return;
    const body = groupNameSchema.safeParse(req.body);
    if (!body.success) return res.status(400).json(badRequest('그룹 이름이 비었거나 너무 깁니다.'));
    const orgId = req.params.id;
    if ((await repo().countGroups(orgId)) >= EXTENSION_ORG_DEPLOYMENT_LIMITS.MAX_GROUPS_PER_ORG) {
        return res.status(400).json(badRequest(`그룹은 조직당 ${EXTENSION_ORG_DEPLOYMENT_LIMITS.MAX_GROUPS_PER_ORG}개까지입니다.`));
    }
    try {
        const group = await repo().createGroup(`org-group-${randomUUID()}`, orgId, body.data.name, String(req.user!.id));
        await audit(req, orgId, { groupCreated: group.id, name: group.name });
        res.status(201).json(success({ group }));
    } catch (e) {
        if ((e as { code?: string }).code === '23505') return res.status(409).json(conflict('같은 이름의 그룹이 있습니다.'));
        throw e;
    }
}));

r.patch('/:id/groups/:groupId', requireAuth, asyncHandler(async (req: Request, res: Response) => {
    if (!(await gate(req, res, 'write'))) return;
    const body = groupNameSchema.safeParse(req.body);
    if (!body.success) return res.status(400).json(badRequest('그룹 이름이 비었거나 너무 깁니다.'));
    const { id, groupId } = req.params;
    if (!(await assertGroupInOrg(res, id, groupId))) return;
    try {
        await repo().renameGroup(id, groupId, body.data.name);
    } catch (e) {
        if ((e as { code?: string }).code === '23505') return res.status(409).json(conflict('같은 이름의 그룹이 있습니다.'));
        throw e;
    }
    res.json(success({ groupId, name: body.data.name }));
}));

r.delete('/:id/groups/:groupId', requireAuth, asyncHandler(async (req: Request, res: Response) => {
    if (!(await gate(req, res, 'delete'))) return;
    const { id, groupId } = req.params;
    if (!(await assertGroupInOrg(res, id, groupId))) return;
    await repo().deleteGroup(id, groupId);
    await audit(req, id, { groupDeleted: groupId });
    triggerOrgReconcile(id);
    res.json(success({ deleted: true }));
}));

r.put('/:id/groups/:groupId/members/:userId', requireAuth, asyncHandler(async (req: Request, res: Response) => {
    if (!(await gate(req, res, 'write'))) return;
    const { id, groupId, userId } = req.params;
    if (!(await assertGroupInOrg(res, id, groupId))) return;
    try {
        await repo().addGroupMember(id, groupId, userId);
    } catch (e) {
        // 복합 FK(organization_members) — 이 조직 멤버가 아니다
        if ((e as { code?: string }).code === '23503') return res.status(400).json(badRequest('이 조직의 멤버가 아닙니다.'));
        throw e;
    }
    await audit(req, id, { groupId, memberAdded: userId });
    triggerOrgReconcile(id);
    res.json(success({ groupId, userId }));
}));

r.delete('/:id/groups/:groupId/members/:userId', requireAuth, asyncHandler(async (req: Request, res: Response) => {
    if (!(await gate(req, res, 'write'))) return;
    const { id, groupId, userId } = req.params;
    if (!(await assertGroupInOrg(res, id, groupId))) return;
    if (!(await repo().removeGroupMember(id, groupId, userId))) return res.status(404).json(notFound('그룹 멤버가 아닙니다.'));
    await audit(req, id, { groupId, memberRemoved: userId });
    res.json(success({ removed: true }));
}));
