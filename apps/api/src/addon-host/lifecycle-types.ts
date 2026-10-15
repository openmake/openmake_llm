/**
 * Add-on 런타임 수명주기 계약 (설계 2026-10-16 3차 §2 C1).
 *
 * 런타임 진입점(`entry.runtime`)은 `AddonRuntimeHost` 를 받고 `void` 또는 `AddonRuntimeHandle` 을 돌려준다 —
 * `void` 를 돌려주는 기존 add-on 은 그대로 동작한다(정지 수단이 없어 토글은 재시작 필요로 안내된다).
 * 코드 언로드는 하지 않는다(결정 D1). handle 은 같은 프로세스에서 신규 작업을 멈추고(stop-admission) 진행 중 작업을
 * 시간 제한 안에서 마치게(drain) 하는 수단이다. 계약 패키지(C2)로 옮길 때 이 파일을 그대로 옮긴다(런타임 의존 없음).
 *
 * @module addon-host/lifecycle-types
 */
import type { CapabilityDefinition, CapabilityHandler, CapabilityOwner } from '../capability-contract/types';

/** 런타임이 스스로 보고하는 상태 — 관리 화면·종료 로그용(판정에는 쓰지 않는다) */
export interface AddonRuntimeHealth {
    /** running = 신규 작업 받는 중, draining = 정지 요청 뒤 진행 중 작업이 남음, stopped = 신규·진행 모두 없음 */
    status: 'running' | 'draining' | 'stopped';
    /** 진행 중 작업 수 */
    inflight?: number;
    detail?: string;
}

export interface AddonRuntimeStopOptions {
    /** true 면 진행 중 작업이 끝나기를 signal 이 끊길 때까지 기다린다. false 면 바로 취소한다 */
    drain: boolean;
    /** drain 시간 제한 — 끊기면 남은 작업을 취소하고 곧바로 돌아와야 한다(호스트는 더 기다리지 않는다) */
    signal: AbortSignal;
}

export interface AddonRuntimeHandle {
    /** 신규 작업 차단 + (drain 이면) 진행 중 작업 마무리. 여러 번 불려도 안전해야 한다 */
    stop(opts: AddonRuntimeStopOptions): Promise<void>;
    /** stop 뒤 같은 프로세스에서 다시 연다. 없으면 다시 켜려면 재시작해야 한다(restart_required) */
    resume?(): Promise<void>;
    health?(): AddonRuntimeHealth;
}

/**
 * 런타임 진입점이 받는 호스트 문맥 — add-on 은 이것으로만 capability 를 게시하고 타이머·정리 함수를 건다.
 * 소유자(addonId·version·source)는 호스트가 채우고, 게시는 manifest `provides` 와 정확히 일치해야 한다.
 * 여기서 건 타이머·정리 함수는 add-on 별로 기록돼 시작 실패·프로세스 종료 때 등록 역순으로 회수된다.
 */
export interface AddonRuntimeHost {
    owner: CapabilityOwner;
    /** 한 트랜잭션으로 등록·게시 — 실패하면 아무것도 게시되지 않는다 */
    registerCapabilities(entries: ReadonlyArray<{ definition: CapabilityDefinition; handler: CapabilityHandler }>): void;
    /** 시작 시간 초과(`ADDON_START_TIMEOUT_MS`)·시작 실패·프로세스 종료 때 끊긴다. 관리자 토글 정지에는 끊기지 않는다(재개할 수 있어야 한다) */
    signal: AbortSignal;
    /** 시작 실패·프로세스 종료 때 호스트가 부를 정리 함수(연결 닫기·구독 해제) — 등록 역순으로, 한 번만 불린다 */
    registerDisposable(name: string, dispose: () => void | Promise<void>): void;
    /** add-on 소유 주기 타이머 — unref 되고, 정리 목록에 자동 등록된다 */
    setInterval(fn: () => void, ms: number): NodeJS.Timeout;
    /** add-on 소유 1회 타이머 — unref 되고, 정리 목록에 자동 등록된다 */
    setTimeout(fn: () => void, ms: number): NodeJS.Timeout;
}

/** 매니페스트 `entry.runtime` 이 가리키는 함수의 모양 */
export type AddonRuntimeEntry = (host: AddonRuntimeHost) => Promise<void | AddonRuntimeHandle>;

/** PURE: 진입점 반환값이 handle 인가 — `void` 를 돌려주는 기존 add-on 과 구분한다 */
export function isAddonRuntimeHandle(value: unknown): value is AddonRuntimeHandle {
    return typeof value === 'object' && value !== null && typeof (value as { stop?: unknown }).stop === 'function';
}
