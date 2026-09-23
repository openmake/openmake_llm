/**
 * Add-on 관리 API (2026-09-19, S3·§10-5) — 설치 목록·상태 토글·사용권 확인.
 *
 * Base 는 개별 add-on 을 모른다. 이 라우트는 **호스트가 발견한 목록과 DB 상태**만 다룬다.
 * 토글은 `addon_installations.state` 를 바꾸고, 라우트 노출·사용권 판정에는 즉시 반영된다 —
 * 런타임 등록(도구·스킬·채팅 모드)은 부팅 시점이라 **재시작이 필요하다**(응답의 `restartRequired`).
 *
 * @module routes/admin-addons.routes
 */
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { requireAuth, requireAdmin } from '../auth';
import { asyncHandler } from '../utils/error-handler';
import { success, notFound } from '../utils/api-response';
import { validate } from '../middlewares/validation';
import { getPool } from '../data/models/unified-database';
import { AddonStateRepository, ADDON_STATES, type AddonState } from '../data/repositories/addon-state-repository';
import { listBuiltinAddons } from '../addon-host/routes';
import { listBuiltinAddonDefs } from '../addon-host/builtin-registry';
import { resolveAddonActivation } from '../addon-host/activation';
import { satisfiesOpenmakeRange } from '../addon-host/manifest';
import { APP_VERSION } from '../config/constants';
import { availableChatModelFacts, checkModelRequirement } from '../services/addon/model-requirements';
import { clearAddonStateCache } from '../services/addon/addon-state';
import { loadPackVerifications } from '../services/addon/pack-verification';
import { getAuditService } from '../services/AuditService';

export const adminAddonsRouter = Router();

/** 상태를 바꿔도 재시작 전에는 반영되지 않는 축 — 관리자에게 그대로 알린다. */
const RESTART_REQUIRED_NOTE = '런타임 등록(도구·스킬 주입·채팅 모드)은 재시작 후 반영됩니다. 라우트 노출과 사용권은 즉시 적용됩니다.';

export const addonStateSchema = z.object({
    state: z.enum(ADDON_STATES),
    reason: z.string().max(2000).optional(),
});

/**
 * GET /api/admin/addons
 * 발견된 add-on(매니페스트) + DB 상태를 합쳐 돌려준다.
 */
adminAddonsRouter.get('/addons', requireAuth, requireAdmin, asyncHandler(async (_req: Request, res: Response) => {
    const rows = await new AddonStateRepository(getPool()).list();
    const byId = new Map(rows.map(r => [r.addon_id, r]));
    const models = await availableChatModelFacts();
    const manifests = new Map(listBuiltinAddonDefs().map(a => [a.id, a.manifest]));
    const verifications = await loadPackVerifications(getPool());
    const addons = listBuiltinAddons().map(a => {
        const row = byId.get(a.id);
        const manifest = manifests.get(a.id);
        // 원하는 상태(DB 의도)와 실제 런타임 준비 상태(이 프로세스)를 분리해 응답한다(P01) — 기존 `state` 는 호환용으로 유지
        const activation = resolveAddonActivation({
            addonId: a.id,
            hasRuntimeEntry: !!manifest?.entry?.runtime,
            versionCompatible: manifest ? satisfiesOpenmakeRange(APP_VERSION, manifest.requires.openmake) : true,
            row: row
                ? { known: true, desiredState: row.desired_state, state: row.state, stateRevision: row.state_revision, lastFailureCode: row.last_failure_code }
                : { known: true, desiredState: 'enabled', state: 'enabled', stateRevision: 0, lastFailureCode: null },
        });
        return {
            id: a.id,
            name: a.name,
            version: a.version,
            kind: a.kind,
            /** env 로 끈 경우 false — DB 토글보다 우선하는 비상 override */
            enabledByEnv: a.enabled,
            state: (row?.state ?? 'enabled') as AddonState,
            /** 관리자의 사용 의도 — 부팅 실패가 바꾸지 않는다 */
            desiredState: activation.desiredState,
            /** 이 프로세스의 코드 로드 상태 — 전역 값이 아니다 */
            runtimeStatus: activation.runtimeStatus,
            restartRequired: activation.restartRequired,
            stateRevision: activation.stateRevision,
            lastFailureCode: activation.lastFailureCode,
            effectiveAvailability: activation.effectiveAvailability,
            source: row?.source ?? 'builtin',
            entitlementSku: row?.entitlement_sku ?? null,
            failureReason: row?.failure_reason ?? null,
            updatedAt: row?.updated_at ?? null,
            /** 매니페스트가 선언한 권한 — 집행 어휘는 config/addon-permissions.ts */
            permissions: manifests.get(a.id)?.permissions ?? [],
            /** 모델 요구 정적 판정 — 요구가 없으면 ok, 미충족이면 사유를 그대로 보여 준다 */
            modelRequirement: checkModelRequirement(manifests.get(a.id)?.requires.model, models),
            /** 팩 검증 실행(`npm run eval:packs`)의 모델별 최신 결과 — 기록이 없으면 빈 배열 */
            verifiedModels: verifications.get(a.id) ?? [],
        };
    });
    res.json(success({ addons, restartNote: RESTART_REQUIRED_NOTE }));
}));

/**
 * PATCH /api/admin/addons/:addonId/state
 * 상태 전환 — installed | enabled | disabled | failed.
 */
adminAddonsRouter.patch('/addons/:addonId/state', requireAuth, requireAdmin, validate(addonStateSchema), asyncHandler(async (req: Request, res: Response) => {
    const { addonId } = req.params;
    const { state, reason } = req.body as z.infer<typeof addonStateSchema>;
    const updated = await new AddonStateRepository(getPool()).setState(addonId, state, reason ?? null);
    if (!updated) {
        res.status(404).json(notFound('add-on'));
        return;
    }
    clearAddonStateCache();
    await getAuditService().logAudit({
        action: 'addon.state_changed',
        userId: req.user?.id !== undefined ? String(req.user.id) : undefined,
        resourceType: 'addon',
        resourceId: addonId,
        details: { state, reason: reason ?? null },
    });
    res.json(success({ addon: updated, restartRequired: true, restartNote: RESTART_REQUIRED_NOTE }));
}));

/**
 * GET /api/admin/model-profiles
 * 로컬 채팅 모델별로 **해석된** 모델 프로필(능력·강도·샘플링·strict·이미지 상한·라이선스)을 읽기 전용으로 보여 준다.
 *
 * S2 잔여 중 "관리자 UI 노출" — 값의 authority 는 선언 테이블(`config/model-profiles.ts`)과
 * env `LLM_MODEL_PROFILES_JSON` 이다(여기서 바꾸지 않는다). 새 모델 도입 = 항목 추가 → eval:matrix → 전환.
 */
adminAddonsRouter.get('/model-profiles', requireAuth, requireAdmin, asyncHandler(async (_req: Request, res: Response) => {
    const { getLocalChatModels } = await import('../config/local-models');
    const { resolveModelProfile, licenseBlockReason } = await import('../config/model-profiles');
    const profiles = getLocalChatModels({ includeUnavailable: true }).map(m => ({
        id: m.id,
        displayName: m.displayName,
        contextLength: m.contextLength ?? null,
        contextLengthProbed: m.contextLengthProbed ?? false,
        available: m.available !== false,
        unavailableReason: m.unavailableReason ?? null,
        profile: resolveModelProfile(m.id),
        licenseBlockReason: licenseBlockReason(m.id),
    }));
    res.json(success({ profiles }));
}));
