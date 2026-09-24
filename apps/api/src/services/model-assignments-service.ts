/**
 * @module services/model-assignments-service
 * @description 통합 모델 배정(슬롯) API 의 조립·검증 로직 — 사용자(`/api/users/me/model-assignments`)와
 * 관리자 전역(`/api/admin/model-assignments`) 라우트가 공유한다.
 *
 * 슬롯 정의는 config/model-slots. 저장은 model_assignments(scope, slot). 검증은 종전 두 경로를 그대로 재사용한다 —
 * text 슬롯은 역할 배정과 같은 규칙(BYOK·채팅 가능 모델·서버 키), modality 슬롯은 기능 배정과 같은 규칙
 * (validateCapabilityAssignment·sanitizeCapabilityParams). 합쳐진 슬롯(code·reasoning)은 text 검증 + 기능 params 정제를 둘 다 적용한다.
 */
import type {
    ModelSlotInfo, ModelSlotAssignment, ModelSlotEffective, ModelAssignmentsResponse,
} from '@openmake/shared-types';
import {
    MODEL_SLOTS, USER_ASSIGNABLE_SLOTS, getModelSlot, type ModelSlotDef,
} from '../config/model-slots';
import {
    CAPABILITY_LIMITS, UNSUPPORTED_CAPABILITIES, GLOBAL_CAPABILITY_SCOPE,
    sanitizeCapabilityParams, type Capability,
} from '../config/capabilities';
import { isExternalFullId, toLocalModelTag } from '../config/model-roles';
import { EXTERNAL_PROVIDER_CATALOG } from '../config/external-providers';
import { getPool } from '../data/models/unified-database';
import { ModelAssignmentsRepository } from '../data/repositories/model-assignments-repo';
import { ServerExternalKeysRepository } from '../data/repositories/server-external-keys-repo';
import { validateModelAssignment } from './model-assignment-validation';
import {
    resolveCapabilityTarget, validateCapabilityAssignment, CapabilityUnavailableError,
} from './orchestrator/capability-resolver';
import { resolveRoleClientForUser } from './model-role-resolver';
import { buildCapabilityCatalog } from './capability-catalog';
import { invalidateGlobalAssignmentCaches } from './model-assignment-cache';
import { AppError } from '../utils/error-handler';

/** 슬롯의 저장 가능한 params 키 — 슬롯이 읽는 기능들의 화이트리스트 합집합(역할 전용 슬롯은 빈 배열) */
function slotParamKeys(slot: ModelSlotDef): string[] {
    const keys = new Set<string>();
    for (const cap of slot.capabilities) for (const k of CAPABILITY_LIMITS.PARAM_KEYS[cap]) keys.add(k);
    return [...keys];
}

/** GET 응답의 slots — USER_ASSIGNABLE_SLOTS 순서, paramKeys·available 포함 */
export async function buildSlotInfos(): Promise<ModelSlotInfo[]> {
    const catalog = await buildCapabilityCatalog();
    const availById = new Map(catalog.entries.map((e) => [e.id, e.availability]));
    return USER_ASSIGNABLE_SLOTS.map((slot) => {
        // 기능이 없는(역할 전용) text 슬롯은 항상 실행 가능. 기능 슬롯은 어댑터(add-on) 가용성 + 미지원 목록으로 판정.
        const available = slot.capabilities.length === 0
            ? true
            : slot.capabilities.some((cap) => !UNSUPPORTED_CAPABILITIES.has(cap) && availById.get(cap) === 'available');
        return {
            id: slot.id,
            group: slot.group!, // USER_ASSIGNABLE_SLOTS 는 모두 group 이 있다(chat·router 만 null·비배정)
            kind: slot.kind,
            roles: [...slot.roles],
            capabilities: [...slot.capabilities],
            paramKeys: slotParamKeys(slot),
            available,
        };
    });
}

/** 슬롯 하나의 실효 모델 해석 — 기능 슬롯은 capability 해석, 역할 전용 슬롯은 role 해석 */
async function effectiveForSlot(slot: ModelSlotDef, resolutionUserId: string | undefined): Promise<ModelSlotEffective> {
    if (slot.capabilities.length > 0) {
        const cap = slot.capabilities[0];
        try {
            const t = await resolveCapabilityTarget(cap, resolutionUserId);
            return { slot: slot.id, fullId: t.fullId, source: t.source };
        } catch (err) {
            if (err instanceof CapabilityUnavailableError) {
                return { slot: slot.id, fullId: null, source: 'none', error: err.message, code: err.code };
            }
            return { slot: slot.id, fullId: null, source: 'none', error: err instanceof Error ? err.message : String(err) };
        }
    }
    // 역할 전용 슬롯 — role 해석기(3단 폴백, fail-open)
    const res = await resolveRoleClientForUser(slot.roles[0], resolutionUserId);
    return { slot: slot.id, fullId: res.fullId, source: res.source };
}

/** GET 응답 전체 — slots·assignments·effective */
export async function buildAssignmentsResponse(opts: { scope: string; resolutionUserId?: string }): Promise<ModelAssignmentsResponse> {
    const repo = new ModelAssignmentsRepository(getPool());
    const [slots, rows, effective] = await Promise.all([
        buildSlotInfos(),
        repo.listByScope(opts.scope),
        Promise.all(USER_ASSIGNABLE_SLOTS.map((s) => effectiveForSlot(s, opts.resolutionUserId))),
    ]);
    const assignments: ModelSlotAssignment[] = rows.map((r) => ({
        slot: r.slot, fullId: r.fullId, params: r.params, updatedAt: r.updatedAt.toISOString(),
    }));
    return { slots, assignments, effective };
}

/** text 슬롯(역할 축) 배정 검증 — 전역은 서버 공용 키 규칙, 사용자는 BYOK probe 규칙. 실패 사유 문자열/통과 시 null */
async function validateTextSlotAssignment(scope: string, fullId: string): Promise<string | null> {
    if (scope === GLOBAL_CAPABILITY_SCOPE) {
        // admin-model-roles PUT 과 동일: 외부는 카탈로그·openai-compatible·서버 공용 키 활성, 로컬은 태그 해석 가능
        if (isExternalFullId(fullId)) {
            const providerId = fullId.slice(0, fullId.indexOf(':'));
            const entry = EXTERNAL_PROVIDER_CATALOG.find((p) => p.id === providerId);
            if (!entry || entry.sdkType !== 'openai-compatible') return `provider '${providerId}' 는 역할 배정을 지원하지 않습니다`;
            const serverKey = await new ServerExternalKeysRepository(getPool()).get(providerId);
            if (!serverKey || !serverKey.isActive) return `'${providerId}' 서버 공용 키를 먼저 등록하세요 (전역 매핑은 BYOK 가 아닌 서버 키로 실행됩니다)`;
            return null;
        }
        return toLocalModelTag(fullId) ? null : `해석 불가한 모델 id: '${fullId}'`;
    }
    // 사용자 스코프 — user-model-roles PUT 과 동일한 규칙(BYOK 등록·활성 + 로컬 태그 대조)
    return validateModelAssignment(scope, fullId);
}

export interface PutAssignmentInput {
    scope: string;
    slotId: string;
    /** admin 이면 비배정 슬롯(chat·router)도 허용 */
    admin: boolean;
    model: string;
    params?: Record<string, unknown>;
}

/** 슬롯 배정 저장 — 검증 실패는 AppError(400). 전역 스코프면 캐시를 무효화한다. 감사용 previous 를 함께 반환. */
export async function putAssignment(input: PutAssignmentInput): Promise<{ assignment: ModelSlotAssignment; previous: string | null }> {
    const slot = getModelSlot(input.slotId);
    if (!slot) throw new AppError(`알 수 없는 슬롯: '${input.slotId}'`, 400, true, 'UNKNOWN_SLOT');
    if (!input.admin && !slot.userAssignable) {
        throw new AppError(`배정할 수 없는 슬롯: '${input.slotId}' (허용: ${USER_ASSIGNABLE_SLOTS.map((s) => s.id).join(', ')})`, 400, true, 'SLOT_NOT_ASSIGNABLE');
    }
    const fullId = input.model.trim();
    const cap: Capability | undefined = slot.capabilities[0];
    let params: Record<string, string> = {};

    if (slot.kind === 'text') {
        const reason = await validateTextSlotAssignment(input.scope, fullId);
        if (reason) throw new AppError(reason, 400, true, 'ASSIGNMENT_INVALID');
        // 합쳐진 슬롯(code·reasoning)은 기능도 있으므로 그 기능의 허용 params 로 정제한다(그 외 text 슬롯은 params 없음)
        if (cap) params = sanitizeCapabilityParams(cap, input.params);
    } else {
        // modality 슬롯 — 기능 배정과 동일 규칙
        const reason = await validateCapabilityAssignment(input.scope, fullId, {}, cap);
        if (reason) throw new AppError(reason, 400, true, 'ASSIGNMENT_INVALID');
        params = sanitizeCapabilityParams(cap!, input.params);
    }

    const { row, previous } = await new ModelAssignmentsRepository(getPool()).upsert(input.scope, slot.id, fullId, params);
    if (input.scope === GLOBAL_CAPABILITY_SCOPE) invalidateGlobalAssignmentCaches();
    return {
        assignment: { slot: row.slot, fullId: row.fullId, params: row.params, updatedAt: row.updatedAt.toISOString() },
        previous,
    };
}

/** 슬롯 배정 해제 — 없으면 AppError(404). 전역 스코프면 캐시를 무효화한다. 감사용 previous 반환. */
export async function deleteAssignment(opts: { scope: string; slotId: string; admin: boolean }): Promise<{ previous: string | null }> {
    const slot = getModelSlot(opts.slotId);
    if (!slot) throw new AppError(`알 수 없는 슬롯: '${opts.slotId}'`, 400, true, 'UNKNOWN_SLOT');
    if (!opts.admin && !slot.userAssignable) throw new AppError(`배정할 수 없는 슬롯: '${opts.slotId}'`, 400, true, 'SLOT_NOT_ASSIGNABLE');
    const { deleted, previous } = await new ModelAssignmentsRepository(getPool()).delete(opts.scope, slot.id);
    if (!deleted) throw new AppError('배정 없음', 404, true, 'NOT_FOUND');
    if (opts.scope === GLOBAL_CAPABILITY_SCOPE) invalidateGlobalAssignmentCaches();
    return { previous };
}

/** 전체 슬롯 id(관리자 검증용) — chat·router 포함 */
export const ALL_SLOT_IDS: readonly string[] = MODEL_SLOTS.map((s) => s.id);
