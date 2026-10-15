/**
 * @module controllers/user-extension-permissions
 * @description 설치형 확장의 권한 상태 조회·재승인·철회 (마이그레이션 190, 2026-10-16 — 로드맵 작업 8 · 설계 D4).
 *
 * Endpoints (requireAuth, 소유자 또는 관리자 — 그 밖은 404 로 존재를 숨긴다):
 *   GET  /api/users/me/extensions/:id/permissions          — 상태·승인·요청·막힌 권한, 설치에서 빠진 원격 MCP 서버
 *   POST /api/users/me/extensions/:id/permissions/approve  — 요청 권한 전부 승인 → reviewed (감사 extension.permissions_approved)
 *   POST /api/users/me/extensions/:id/permissions/revoke   — 승인에서 빼고 다시 판정 (감사 extension.permissions_revoked)
 *
 * 재승인·철회는 읽은 요청 권한이 저장 값과 같을 때만 쓴다 — 그 사이 업데이트가 요청을 넓혔으면 409.
 * 네트워크가 열리고 닫히면 연결된 MCP 서버를 바로 고친다(다음 기동부터 적용 — 떠 있는 프로세스는 그대로):
 *   닫힘 → stdio 는 sandbox_network='none', 원격(HTTP)은 enabled=false
 *   열림 → 권한 때문에 막았던 stdio 만 'full'. 설치 때 제외된 원격 서버는 확장을 제거·재설치해야 생긴다(응답 excludedRemoteServers)
 * user-extensions.controller 와 같은 prefix 에 따로 마운트한다 — 그 파일의 '/:id' 는 '/:id/permissions' 와 겹치지 않는다.
 */
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { requireAuth } from '../auth';
import { asyncHandler } from '../utils/error-handler';
import { validate } from '../middlewares/validation';
import { success, notFound, conflict, unauthorized } from '../utils/api-response';
import { getPool } from '../data/models/unified-database';
import { isAdminRole } from '../data/user-manager';
import { UserExtensionRepository, type UserExtensionRow } from '../data/repositories/user-extension-repository';
import { UserExtensionPermissionRepository } from '../data/repositories/user-extension-permission-repository';
import { getAuditService } from '../services/AuditService';
import { createLogger } from '../utils/logger';
import { ADDON_PERMISSION_VALUES } from '../config/addon-permissions';
import {
    allowsNetwork,
    approvePermissions,
    describePermissions,
    evaluatePermissionState,
    permissionExcludedServers,
    revokePermissions,
    type PermissionEvaluation,
} from '../services/extensions/permission-state';

const log = createLogger('UserExtensionPermissions');

export const revokePermissionsSchema = z.object({
    permissions: z.array(z.enum(ADDON_PERMISSION_VALUES)).min(1).max(ADDON_PERMISSION_VALUES.length),
});

const CONFLICT_MESSAGE = '그 사이 확장이 업데이트되어 요청 권한이 바뀌었습니다. 다시 불러온 뒤 확인하세요.';
const AUDIT_RESOURCE_TYPE = 'user_extension';

interface Actor {
    userId: string;
    isAdmin: boolean;
}

/** 소유자 또는 관리자만 — 없거나 남의 것이거나 제거된 확장은 404(존재를 드러내지 않는다) */
async function loadRow(req: Request, res: Response): Promise<{ row: UserExtensionRow; actor: Actor } | null> {
    if (req.user?.id === undefined) {
        res.status(401).json(unauthorized());
        return null;
    }
    const actor: Actor = { userId: String(req.user.id), isAdmin: isAdminRole(req.user.role) };
    const row = await new UserExtensionRepository(getPool()).getByIdForUser(req.params.id, actor.userId, actor.isAdmin);
    if (!row || row.status !== 'active') {
        res.status(404).json(notFound('확장 없음'));
        return null;
    }
    return { row, actor };
}

/** 저장된 상태 그대로의 판정 — 승인·철회 전후 네트워크 개방을 비교한다 */
function currentEvaluation(row: UserExtensionRow): PermissionEvaluation {
    return evaluatePermissionState({
        state: row.permission_state,
        granted: row.permissions_granted,
        requested: row.permissions_requested,
    });
}

export function createUserExtensionPermissionsController(): Router {
    const router = Router();

    router.get('/:id/permissions', requireAuth, asyncHandler(async (req: Request, res: Response) => {
        const loaded = await loadRow(req, res);
        if (!loaded) return;
        res.json(success({
            permissions: describePermissions(loaded.row),
            excludedRemoteServers: permissionExcludedServers(loaded.row.manifest),
        }));
    }));

    router.post('/:id/permissions/approve', requireAuth, asyncHandler(async (req: Request, res: Response) => {
        const loaded = await loadRow(req, res);
        if (!loaded) return;
        const { row, actor } = loaded;
        const before = currentEvaluation(row);
        const next = approvePermissions({ requested: row.permissions_requested });
        const permRepo = new UserExtensionPermissionRepository(getPool());
        const saved = await permRepo.saveReviewIfRequestedUnchanged(row.id, {
            state: next.next,
            granted: next.granted,
            reviewedBy: actor.userId,
            expectedRequested: row.permissions_requested,
        });
        if (!saved) {
            res.status(409).json(conflict(CONFLICT_MESSAGE));
            return;
        }
        const restoredServers = !allowsNetwork(before) && allowsNetwork(next) ? await permRepo.restoreLinkedMcpNetwork(row.id) : 0;
        await getAuditService().logAudit({
            action: 'extension.permissions_approved',
            userId: actor.userId,
            resourceType: AUDIT_RESOURCE_TYPE,
            resourceId: row.id,
            details: { ownerId: row.user_id, previousState: row.permission_state, granted: next.granted, restoredServers },
        });
        log.info(`확장 권한 재승인: ${row.id} (${row.permission_state} → ${next.next}, by=${actor.userId}, restored=${restoredServers})`);
        res.json(success({
            permissions: describePermissions(saved),
            restoredServers,
            excludedRemoteServers: permissionExcludedServers(saved.manifest),
        }));
    }));

    router.post('/:id/permissions/revoke', requireAuth, validate(revokePermissionsSchema), asyncHandler(async (req: Request, res: Response) => {
        const loaded = await loadRow(req, res);
        if (!loaded) return;
        const { row, actor } = loaded;
        const { permissions } = req.body as z.infer<typeof revokePermissionsSchema>;
        const before = currentEvaluation(row);
        const next = revokePermissions(
            { state: row.permission_state, granted: row.permissions_granted, requested: row.permissions_requested },
            permissions,
        );
        const permRepo = new UserExtensionPermissionRepository(getPool());
        const saved = await permRepo.saveReviewIfRequestedUnchanged(row.id, {
            state: next.next,
            granted: next.granted,
            reviewedBy: actor.userId,
            expectedRequested: row.permissions_requested,
        });
        if (!saved) {
            res.status(409).json(conflict(CONFLICT_MESSAGE));
            return;
        }
        const restricted = allowsNetwork(before) && !allowsNetwork(next)
            ? await permRepo.restrictLinkedMcpNetwork(row.id)
            : { sandboxed: 0, disabled: 0 };
        await getAuditService().logAudit({
            action: 'extension.permissions_revoked',
            userId: actor.userId,
            resourceType: AUDIT_RESOURCE_TYPE,
            resourceId: row.id,
            details: { ownerId: row.user_id, previousState: row.permission_state, revoked: permissions, state: next.next, granted: next.granted, ...restricted },
        });
        log.info(`확장 권한 철회: ${row.id} (${permissions.join(',')} → ${next.next}, by=${actor.userId}, sandboxed=${restricted.sandboxed}, disabled=${restricted.disabled})`);
        res.json(success({ permissions: describePermissions(saved), restricted }));
    }));

    return router;
}
