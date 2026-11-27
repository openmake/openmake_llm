/**
 * 조직 소유 확장 라우트(P8, opt-in EXTENSION_ORG_OWNED_INSTALL_ENABLED, 212) — user-extensions.controller 가 '/:id' 보다 먼저 붙인다.
 *
 *   GET    /api/users/me/extensions/org-owned              — 활성 조직의 조직 소유 확장(멤버 읽기)
 *   POST   /api/users/me/extensions/org-owned              — 활성 조직 소유로 설치(조직 owner·admin)
 *   POST   /api/users/me/extensions/org-owned/:id/update   — 원본 재해석 후 커밋/digest 갱신(조직 owner·admin 누구나)
 *   DELETE /api/users/me/extensions/org-owned/:id          — 제거(조직 owner·admin 누구나)
 *
 * 플래그 OFF 면 인증보다 먼저 `next('route')` 로 넘어간다 — 종전과 같은 라우트(`/:id` 등)·같은 응답.
 * 권한 판정·감사는 services/extensions/org-owned-install. 오류는 AppError 를 던져 전역 errorHandler 가 상태 코드를 붙인다.
 *
 * @module controllers/user-extensions-org-owned.routes
 */
import type { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { requireAuth } from '../auth/middleware';
import { getPool } from '../data/models/unified-database';
import { extensionOrgOwnedInstallEnabled } from '../config/extension-org-owned';
import { buildExtensionIngestService } from '../services/extensions/ingest-service-factory';
import { activeOrgFor } from '../services/org/membership-cache';
import {
    installOrgOwnedExtension, listOrgOwnedExtensions, removeOrgOwnedExtension, updateOrgOwnedExtension,
    type OrgOwnedActor, type OrgOwnedDeps,
} from '../services/extensions/org-owned-install';
import type { OrgOwnedExtensionRow } from '../data/repositories/org-owned-extension-repository';
import { ValidationError } from '../utils/error-handler';
import { success, unauthorized } from '../utils/api-response';

export const orgOwnedInstallSchema = z.object({
    gitUrl: z.string().min(3).max(500),
    gitRef: z.string().max(200).optional(),
    gitPath: z.string().max(500).optional(),
    plugin: z.string().max(120).optional(),
    accessToken: z.string().max(200).optional(),
}).strict();

const orgOwnedUpdateSchema = z.object({ accessToken: z.string().max(200).optional() }).strict();

export interface OrgOwnedRouteDeps {
    getUserId(req: Request): string | null;
    /** 테스트 주입용 — 기본은 실제 풀·설치 엔진·멤버십·감사 */
    serviceDeps?: () => Promise<OrgOwnedDeps>;
}

async function defaultServiceDeps(userId: string, isAdmin: boolean): Promise<OrgOwnedDeps> {
    const ingest = await buildExtensionIngestService({ userId, isAdmin });
    return {
        pool: getPool(),
        resolveSource: (input) => ingest.resolveSource(input),
        activeOrg: (uid) => activeOrgFor(uid),
        audit: async (a) => {
            const { getAuditService } = await import('../services/AuditService');
            await getAuditService().logAudit({ action: a.action, userId: a.userId, resourceType: 'user_extension', resourceId: a.resourceId, details: a.details });
        },
    };
}

/** 응답 — 설치자 id·내부 해시는 싣지 않는다 */
function toPublicOrgOwned(row: OrgOwnedExtensionRow) {
    const { source_hash: _h, user_id: _u, installed_by_user_id: _i, permissions_reviewed_by: _r, ...rest } = row;
    return { ...rest, orgOwned: true };
}

/** 플래그 게이트 — OFF 면 이 라우트를 건너뛴다(인증 전) */
function gate(_req: Request, _res: Response, next: NextFunction): void {
    if (extensionOrgOwnedInstallEnabled()) next();
    else next('route');
}

function parse<T>(schema: z.ZodType<T>, body: unknown): T {
    const r = schema.safeParse(body ?? {});
    if (!r.success) throw new ValidationError(r.error.issues.map((i) => `${i.path.join('.') || '(body)'}: ${i.message}`).join('; '));
    return r.data;
}

export function registerOrgOwnedRoutes(router: Router, deps: OrgOwnedRouteDeps): void {
    const actorOf = (req: Request): OrgOwnedActor | null => {
        const userId = deps.getUserId(req);
        return userId ? { userId, role: req.user?.role } : null;
    };
    const svc = (actor: OrgOwnedActor) => (deps.serviceDeps ? deps.serviceDeps() : defaultServiceDeps(actor.userId, actor.role === 'admin'));

    router.get('/org-owned', gate, requireAuth, async (req, res) => {
        const actor = actorOf(req);
        if (!actor) { res.status(401).json(unauthorized()); return; }
        const rows = await listOrgOwnedExtensions(await svc(actor), actor);
        res.json(success({ extensions: rows.map(toPublicOrgOwned) }));
    });

    router.post('/org-owned', gate, requireAuth, async (req, res) => {
        const actor = actorOf(req);
        if (!actor) { res.status(401).json(unauthorized()); return; }
        const body = parse(orgOwnedInstallSchema, req.body);
        const result = await installOrgOwnedExtension(await svc(actor), actor, body);
        if ('selectionRequired' in result) { res.json(success(result)); return; }
        res.status(201).json(success({ extension: toPublicOrgOwned(result) }));
    });

    router.post('/org-owned/:id/update', gate, requireAuth, async (req, res) => {
        const actor = actorOf(req);
        if (!actor) { res.status(401).json(unauthorized()); return; }
        const body = parse(orgOwnedUpdateSchema, req.body);
        const r = await updateOrgOwnedExtension(await svc(actor), actor, String(req.params.id), body);
        res.json(success({ extension: toPublicOrgOwned(r.row), upToDate: r.upToDate, previousRef: r.previousRef, previousVersion: r.previousVersion }));
    });

    router.delete('/org-owned/:id', gate, requireAuth, async (req, res) => {
        const actor = actorOf(req);
        if (!actor) { res.status(401).json(unauthorized()); return; }
        const removed = await removeOrgOwnedExtension(await svc(actor), actor, String(req.params.id));
        res.json(success({ extension: toPublicOrgOwned(removed) }));
    });
}
