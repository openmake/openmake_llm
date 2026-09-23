/**
 * 실행 승인(admission) — "이 capability 를 지금 이 사용자가 실행해도 되나" 의 단일 판정 (P03, 2026-09-23).
 *
 * preflight 가 발급하는 `ApprovedInvocationHandle` 과 실행 직전 재검사가 **같은 함수**를 쓴다(계획서 8.3·9.2).
 * 판정 축: ① Registry 등록(소유 add-on 이 켜져 부팅됐나) ② 소유 add-on 의 DB 의도(관리자가 계획 뒤에 껐나 — T03)
 * ③ 상태 저장소 조회 실패는 **차단**(T22 — '정책 없음' 으로 읽지 않는다). Base 소유(텍스트·비전·오디오·웹)는 DB 를 묻지 않는다
 * (미디어 add-on 을 전부 꺼도, DB 가 죽어도 일반 채팅은 그대로 돈다).
 * 모델 배정·키·예산은 종전대로 `capability-resolver` 가 판정하고 그 결과(target)가 handle 에 실린다.
 *
 * @module capability-contract/admission
 */
import { getCapabilityRegistry } from '../runtime-ports/capability-runtime';
import { readAddonStateStrict } from '../services/addon/addon-state';
import { BASE_CAPABILITY_OWNER, type CapabilityOwner } from './types';

export type AdmissionRejectCode = 'CAPABILITY_NOT_REGISTERED' | 'ADDON_DISABLED' | 'ADDON_FAILED' | 'ADDON_STATE_UNKNOWN' | 'OWNER_CHANGED';

export type AdmissionVerdict =
    | { ok: true; owner: CapabilityOwner; registryRevision: number; stateRevision: number }
    | { ok: false; code: AdmissionRejectCode; reason: string };

/** 사용자 표시용 상태 라벨 — 종합 답변·오류 문구가 `[disabled]` 류 접두로 쓴다 */
export const ADMISSION_LABEL: Record<AdmissionRejectCode, string> = {
    CAPABILITY_NOT_REGISTERED: 'disabled',
    ADDON_DISABLED: 'disabled',
    ADDON_FAILED: 'failed',
    ADDON_STATE_UNKNOWN: 'state_unknown',
    OWNER_CHANGED: 'not_ready',
};

export async function admitCapability(capability: string, opts: { expectedOwner?: CapabilityOwner } = {}): Promise<AdmissionVerdict> {
    const registry = getCapabilityRegistry();
    const reg = registry.get(capability);
    if (!reg) return { ok: false, code: 'CAPABILITY_NOT_REGISTERED', reason: `${capability}: 제공하는 add-on 이 꺼져 있거나 준비되지 않았습니다` };
    if (opts.expectedOwner && opts.expectedOwner.addonId !== reg.owner.addonId) {
        return { ok: false, code: 'OWNER_CHANGED', reason: `${capability}: 승인 뒤 소유 add-on 이 바뀌었습니다 (${opts.expectedOwner.addonId} → ${reg.owner.addonId})` };
    }
    if (reg.owner.addonId === BASE_CAPABILITY_OWNER.addonId) return { ok: true, owner: reg.owner, registryRevision: registry.revision, stateRevision: 0 };
    const state = await readAddonStateStrict(reg.owner.addonId);
    if (!state.known) return { ok: false, code: 'ADDON_STATE_UNKNOWN', reason: `${capability}: add-on '${reg.owner.addonId}' 상태를 확인할 수 없어 실행하지 않습니다 (${state.reason})` };
    if (state.desiredState !== 'enabled') return { ok: false, code: 'ADDON_DISABLED', reason: `${capability}: add-on '${reg.owner.addonId}' 이 관리자에 의해 중지되었습니다` };
    if (state.state === 'failed') return { ok: false, code: 'ADDON_FAILED', reason: `${capability}: add-on '${reg.owner.addonId}' 부팅이 실패한 상태입니다 (${state.lastFailureCode ?? 'failed'})` };
    return { ok: true, owner: reg.owner, registryRevision: registry.revision, stateRevision: state.stateRevision };
}

/**
 * preflight 가 발급하는 승인 handle — 실행기는 여기 고정된 사용자·capability·대상만 호출한다(실행 중 재해석 금지).
 * raw key·헤더는 `target` 안에 있고 P04 의 Restricted ModelInvoker 가 그것을 포트 안으로 감춘다.
 */
export interface ApprovedInvocationHandle {
    taskId: string;
    capability: string;
    userId?: string;
    sessionId?: string;
    owner: CapabilityOwner;
    registryRevision: number;
    stateRevision: number;
    issuedAt: number;
    /** 이 handle 로 실행을 시작할 수 있는 마지막 시각(ms) — 계획과 실행 사이 지연 상한 */
    deadline: number;
}

/** 실행 단계가 던지는 승인 거절 — `label` 은 결과 텍스트의 `[…]` 접두(disabled·state_unknown·expired·unapproved…) */
export class CapabilityAdmissionError extends Error {
    constructor(public readonly label: string, reason: string) { super(reason); }
}

/** 실행 직전 재검사 — 승인 시점과 같은 소유자·의도인지. 바뀌었으면 사유를 돌려준다(유료 요청 전송 전) */
export async function recheckHandle(handle: ApprovedInvocationHandle, now = Date.now()): Promise<{ ok: true } | { ok: false; code: AdmissionRejectCode | 'HANDLE_EXPIRED'; reason: string }> {
    if (now > handle.deadline) return { ok: false, code: 'HANDLE_EXPIRED', reason: `${handle.capability}: 승인이 만료되었습니다` };
    // 의도가 여전히 enabled 면 revision 이 올랐어도(실패 후 복구 등) 실행은 허용한다 — 차단 사유는 admit 이 낸다
    const v = await admitCapability(handle.capability, { expectedOwner: handle.owner });
    return v.ok ? { ok: true } : v;
}
