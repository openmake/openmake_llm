/**
 * Add-on 활성 판정 — **발견 정보**(매니페스트·env)와 **실효 활성**(DB 의도·프로세스 런타임 상태)의 분리 (P01, 2026-09-23).
 *
 * 축 넷을 따로 둔다(계획서 7.2):
 *   - `enabledByEnv`     : 배포 환경의 비상 차단(`ADDON_BUILTIN_DISABLED`) — 재시작 단위
 *   - `desiredState`     : DB 가 기록한 관리자의 사용 의도 — 실시간
 *   - `runtimeStatus`    : **이 프로세스**가 그 add-on 의 코드를 어디까지 세웠나(not_loaded·registering·ready·failed) —
 *                          전역 DB 의 단일 값으로 대체하지 않는다(프로세스마다 다를 수 있다)
 *   - `effectiveAvailability` : 위 셋과 조회 성공 여부를 합성한 결과(6.4 상태표의 부분집합)
 *
 * 상태 저장과 런타임 존재를 같은 것으로 보지 않는다 — DB 가 enabled 라도 이 프로세스가 등록에 실패했으면 `failed`,
 * 재시작 전이면 `not_ready` 다. 순수 함수 + 프로세스 메모리 표뿐이고 DB 를 직접 읽지 않는다.
 *
 * @module addon-host/activation
 */
import type { AddonDesiredState, AddonFailureCode, AddonState } from '../data/repositories/addon-state-repository';
import { isBuiltinAddonEnabled } from './builtin-registry';

export type AddonRuntimeStatus = 'not_loaded' | 'registering' | 'ready' | 'failed';

/** 6.4 가용성 상태 중 add-on 축이 결정하는 것 — capability 축(unassigned·unsupported·forbidden)은 Registry 가 더한다 */
export type AddonAvailability = 'available' | 'disabled' | 'not_ready' | 'failed' | 'incompatible' | 'state_unknown';

export interface AddonActivation {
    addonId: string;
    enabledByEnv: boolean;
    /** DB 를 읽지 못했으면 null — `state_unknown` 으로 흘러간다(정책 없음과 조회 실패를 섞지 않는다) */
    desiredState: AddonDesiredState | null;
    /** 호환 응답용 종전 state */
    state: AddonState | null;
    stateRevision: number | null;
    lastFailureCode: AddonFailureCode | null;
    runtimeStatus: AddonRuntimeStatus;
    /** 코드 로드가 필요한 add-on 인데(entry.runtime) 이 프로세스에 아직 없거나 의도와 다른 상태 */
    restartRequired: boolean;
    effectiveAvailability: AddonAvailability;
}

/** 이 프로세스의 런타임 상태 표 — 부팅 절차(index.ts)만 쓴다 */
const runtimeStatuses = new Map<string, { status: AddonRuntimeStatus; failureCode?: AddonFailureCode; reason?: string }>();

export function setAddonRuntimeStatus(addonId: string, status: AddonRuntimeStatus, failure?: { code: AddonFailureCode; reason: string }): void {
    runtimeStatuses.set(addonId, { status, ...(failure ? { failureCode: failure.code, reason: failure.reason } : {}) });
}

export function getAddonRuntimeStatus(addonId: string): { status: AddonRuntimeStatus; failureCode?: AddonFailureCode; reason?: string } {
    return runtimeStatuses.get(addonId) ?? { status: 'not_loaded' };
}

/** 테스트 정리용 */
export function resetAddonRuntimeStatusesForTest(): void {
    runtimeStatuses.clear();
}

export interface ActivationInput {
    addonId: string;
    /** 매니페스트가 코드 진입점(entry.runtime)을 선언했나 — 없으면 재시작 축이 무의미하다 */
    hasRuntimeEntry: boolean;
    /** 앱 버전 호환(`satisfiesOpenmakeRange`) — false 면 `incompatible` */
    versionCompatible: boolean;
    /** DB 행(없으면 미등록 = 기본 enabled 의도), 조회 실패면 `{ known: false }` */
    row: { known: true; desiredState: AddonDesiredState; state: AddonState; stateRevision: number; lastFailureCode: AddonFailureCode | null } | { known: false };
}

/** PURE: 축들을 합성한다. 우선순위 — env 차단 > 버전 불일치 > 조회 실패 > 의도 disabled > 런타임 실패 > 준비 전 > available */
export function resolveAddonActivation(input: ActivationInput): AddonActivation {
    const enabledByEnv = isBuiltinAddonEnabled(input.addonId);
    const runtime = getAddonRuntimeStatus(input.addonId);
    const known = input.row.known ? input.row : null;
    const desiredState = known?.desiredState ?? null;
    const base = {
        addonId: input.addonId, enabledByEnv, desiredState,
        state: known?.state ?? null, stateRevision: known?.stateRevision ?? null,
        lastFailureCode: runtime.failureCode ?? known?.lastFailureCode ?? null,
        runtimeStatus: runtime.status,
    };
    const restartRequired = input.hasRuntimeEntry && enabledByEnv && desiredState === 'enabled' && runtime.status === 'not_loaded';
    let effectiveAvailability: AddonAvailability;
    if (!enabledByEnv) effectiveAvailability = 'disabled';
    else if (!input.versionCompatible) effectiveAvailability = 'incompatible';
    else if (!known) effectiveAvailability = 'state_unknown';
    else if (desiredState !== 'enabled') effectiveAvailability = 'disabled';
    else if (runtime.status === 'failed' || known.state === 'failed') effectiveAvailability = 'failed';
    else if (input.hasRuntimeEntry && runtime.status !== 'ready') effectiveAvailability = 'not_ready';
    else effectiveAvailability = 'available';
    return { ...base, restartRequired, effectiveAvailability };
}
