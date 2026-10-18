/**
 * Add-on 활성 판정 — **발견 정보**(매니페스트·env)와 **실효 활성**(DB 의도·프로세스 런타임 상태)의 분리 (P01, 2026-09-23).
 *
 * 축 넷을 따로 둔다(계획서 7.2):
 *   - `enabledByEnv`     : 배포 환경의 비상 차단(`ADDON_BUILTIN_DISABLED`) — 재시작 단위
 *   - `desiredState`     : DB 가 기록한 관리자의 사용 의도 — 실시간
 *   - `runtimeStatus`    : **이 프로세스**가 그 add-on 의 코드를 어디까지 세웠나(not_loaded·registering·ready·stopping·stopped·failed) —
 *                          전역 DB 의 단일 값으로 대체하지 않는다(프로세스마다 다를 수 있다)
 *   - `effectiveAvailability` : 위 셋과 조회 성공 여부를 합성한 결과(6.4 상태표의 부분집합)
 *
 * 상태 저장과 런타임 존재를 같은 것으로 보지 않는다 — DB 가 enabled 라도 이 프로세스가 등록에 실패했으면 `failed`,
 * 재시작 전이면 `not_ready` 다. 순수 함수 + 프로세스 메모리 표뿐이고 DB 를 직접 읽지 않는다.
 *
 * @module addon-host/activation
 */
import type {
    AddonAvailability, AddonDesiredState, AddonFailureCode, AddonRuntimeStatus, AddonState,
} from '@openmake/plugin-contracts';
import { isBuiltinAddonEnabled } from './builtin-registry';

/**
 * 런타임 상태·가용성 어휘 — 정의는 계약 패키지(3차 C2), 여기서는 재수출만 한다.
 * stopping·stopped 는 관리자 토글·프로세스 종료로 런타임 handle 을 정지한 상태(코드는 프로세스에 남는다 — lifecycle.ts).
 * 가용성은 6.4 상태 중 add-on 축이 결정하는 것 — capability 축(unassigned·unsupported·forbidden)은 Registry 가 더한다.
 */
export type { AddonAvailability, AddonRuntimeStatus } from '@openmake/plugin-contracts';

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

/** 이 프로세스의 런타임 상태 표 — 부팅 절차(index.ts)와 수명주기(lifecycle.ts)만 쓴다 */
const runtimeStatuses = new Map<string, { status: AddonRuntimeStatus; failureCode?: AddonFailureCode; reason?: string }>();

export function setAddonRuntimeStatus(addonId: string, status: AddonRuntimeStatus, failure?: { code: AddonFailureCode; reason: string }): void {
    runtimeStatuses.set(addonId, { status, ...(failure ? { failureCode: failure.code, reason: failure.reason } : {}) });
}

export function getAddonRuntimeStatus(addonId: string): { status: AddonRuntimeStatus; failureCode?: AddonFailureCode; reason?: string } {
    return runtimeStatuses.get(addonId) ?? { status: 'not_loaded' };
}

/** 이 프로세스가 add-on 부팅(`bootAddons`)을 했나 — 별도 worker 프로세스·단위 테스트는 하지 않는다 */
let bootRanInProcess = false;
/** 부팅 후보였던 add-on → 이 프로세스에서 코드·스키마를 세워야 쓸 수 있나(런타임 진입점 또는 마이그레이션) */
const bootRequired = new Map<string, boolean>();

/** 부팅 절차(index.ts bootAddons)가 시작할 때 후보를 기록한다 */
export function recordAddonBootCandidates(list: ReadonlyArray<{ addonId: string; requiresProcessBoot: boolean }>): void {
    bootRanInProcess = true;
    for (const c of list) bootRequired.set(c.addonId, c.requiresProcessBoot);
}

/**
 * 이 프로세스에서 그 add-on 이 요청을 받을 준비가 됐나 — 요청 게이트(`services/addon/addon-state`)가 DB 의도 위에 겹친다.
 *   failed    : 이 프로세스의 부팅이 실패했다
 *   not_ready : 코드·스키마를 세워야 하는 add-on 인데 `ready` 가 아니다(부팅 때 꺼져 있다가 나중에 켬·재개 실패·종료 중) — 재시작해야 반영
 *   ready     : 준비됨, 또는 세울 것이 없는 add-on(라우트·콘텐츠만 — 실시간 토글이 그대로 반영된다)
 *   unknown   : 판정하지 않는다 — 부팅을 하지 않은 프로세스(별도 worker)·부팅 후보가 아니던 add-on(설치형 확장 등)
 */
export type AddonProcessReadiness = 'ready' | 'failed' | 'not_ready' | 'unknown';

export function getAddonProcessReadiness(addonId: string): AddonProcessReadiness {
    const status = getAddonRuntimeStatus(addonId).status;
    if (status === 'failed') return 'failed';
    const required = bootRequired.get(addonId);
    if (!bootRanInProcess || required === undefined) return 'unknown';
    if (!required) return 'ready';
    return status === 'ready' ? 'ready' : 'not_ready';
}

/** 테스트 정리용 */
export function resetAddonRuntimeStatusesForTest(): void {
    runtimeStatuses.clear();
    bootRequired.clear();
    bootRanInProcess = false;
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
    // 의도는 켜짐인데 이 프로세스의 런타임이 없거나(not_loaded) 정지된 채(stopped — resume 이 없거나 실패) 남아 있으면 재시작해야 반영된다
    const restartRequired = input.hasRuntimeEntry && enabledByEnv && desiredState === 'enabled'
        && (runtime.status === 'not_loaded' || runtime.status === 'stopped');
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
