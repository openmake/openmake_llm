/**
 * Add-on 수명주기 — 시작(시간 제한)·정지(drain)·재개·자원 회수 (설계 2026-10-16 3차 §2 C1, 로드맵 작업 4·5).
 *
 * 코드 언로드는 하지 않는다(결정 D1 — 재시작 필요 유지). 런타임 진입점이 돌려준 `AddonRuntimeHandle` 로 같은 프로세스에서
 * 신규 작업을 멈추고(stop-admission) 진행 중 작업을 시간 제한 안에서 마치게(drain) 하며, `resume()` 이 있으면 다시 연다.
 * 호스트가 준 타이머·정리 함수는 add-on 별 기록(`AddonLifecycleRecord`)에 쌓여 시작 실패·프로세스 종료 때 등록 역순으로 회수된다.
 *
 * - 시작 실패 보상 순서: handle 즉시 정지 → 정리 함수(역순) → 기여 도구(`unregisterToolContributions`) → capability(`unregisterOwner`).
 * - 포트 등록(`registerToolRuntime`·`registerSkillRuntime`)은 Base 의 단일 포트라 회수 대상이 아니다.
 * - 런타임 상태의 단일 원천은 `activation.ts` 의 표다(이 기록은 상태를 따로 들지 않는다).
 * - 같은 add-on 의 정지·재개는 기록의 `queue` 로 한 줄로 세운다(끄기·켜기 연타 경합 방지).
 *
 * @module addon-host/lifecycle
 */
import { createLogger } from '../utils/logger';
import { ADDON_DRAIN_TIMEOUT_MS, ADDON_START_TIMEOUT_MS } from '../config/runtime-limits';
import { getCapabilityRegistry, registerCapabilities } from '../runtime-ports/capability-runtime';
import { unregisterToolContributions } from '../runtime-ports/builtin-tool-contributions';
import type { CapabilityOwner } from '../capability-contract/types';
import { getAddonRuntimeStatus, setAddonRuntimeStatus } from './activation';
import { listBuiltinAddonDefs, type BuiltinAddon } from './builtin-registry';
import { isAddonRuntimeHandle, type AddonRuntimeHandle, type AddonRuntimeHost } from './lifecycle-types';
import type { AddonDesiredState } from '../data/repositories/addon-state-repository';

const logger = createLogger('AddonLifecycle');

export interface AddonLifecycleRecord {
    addonId: string;
    /** 진입점이 돌려준 handle — 기존 진입점(void)이면 null */
    handle: AddonRuntimeHandle | null;
    /** 등록 순서대로 쌓는다 — 회수는 역순 */
    disposables: Array<{ name: string; dispose: () => void | Promise<void> }>;
    /** host.signal 의 원천 — 시작 시간 초과·시작 실패·프로세스 종료 때 끊는다(토글 정지에는 끊지 않는다) */
    controller: AbortController;
    /** 같은 add-on 의 정지·재개를 한 줄로 세우는 꼬리 — 거절되지 않는다 */
    queue: Promise<void>;
}

const records = new Map<string, AddonLifecycleRecord>();

function errorMessage(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
}

/**
 * Node 타이머가 그대로 지키는 지연 상한(ms, 32비트 부호 있는 정수). NaN·음수·비정수는 `AbortSignal.timeout` 이 RangeError 를 던지고,
 * 이 값을 넘으면 던지지 않고 TimeoutOverflowWarning 뒤 1ms 로 바뀐다(즉시 시간 초과).
 */
const MAX_TIMER_DELAY_MS = 2 ** 31 - 1;

/** env 오입력(NaN·음수·상한 초과)을 `AbortSignal.timeout` 에 넘기기 전에 거른다 */
function isTimerDelay(ms: number): boolean {
    return Number.isInteger(ms) && ms >= 0 && ms <= MAX_TIMER_DELAY_MS;
}

/** 정지·정리의 기다림 상한 signal — 값이 잘못되면 기다리지 않고 바로 취소한다(멈추거나 끝없이 기다리지 않게) */
function waitLimit(ms: number, addonId: string): AbortSignal {
    if (isTimerDelay(ms)) return AbortSignal.timeout(ms);
    logger.warn(`add-on 기다림 상한 값이 잘못됨(${ms}) — '${addonId}' 즉시 취소`);
    return AbortSignal.abort();
}

function createRecord(addonId: string): AddonLifecycleRecord {
    const record: AddonLifecycleRecord = {
        addonId, handle: null, disposables: [], controller: new AbortController(), queue: Promise.resolve(),
    };
    records.set(addonId, record);
    return record;
}

function hostFor(addon: BuiltinAddon, record: AddonLifecycleRecord): AddonRuntimeHost {
    const owner: CapabilityOwner = { addonId: addon.id, addonVersion: addon.manifest.version, source: 'builtin' };
    const aborted = (): boolean => record.controller.signal.aborted;
    // host.signal 이 끊긴 뒤(시작 시간 초과·실패 회수·종료)의 등록은 이미 비운 목록에 쌓이지 않게 곧바로 정리한다
    const track = (name: string, dispose: () => void | Promise<void>): void => {
        if (!aborted()) { record.disposables.push({ name, dispose }); return; }
        logger.warn(`add-on '${addon.id}' 회수 뒤 늦은 등록 '${name}' — 등록하지 않고 바로 정리`);
        Promise.resolve().then(dispose).catch((err: unknown) => {
            logger.warn(`add-on '${addon.id}' 늦은 정리 '${name}' 오류: ${errorMessage(err)}`);
        });
    };
    return {
        owner,
        signal: record.controller.signal,
        registerCapabilities: (entries) => {
            // 실패·회수된 add-on 의 capability 를 다시 게시하지 않는다
            if (aborted()) { logger.warn(`add-on '${addon.id}' 회수 뒤 늦은 capability 게시 — 무시`); return; }
            registerCapabilities(owner, entries, addon.manifest.provides?.capabilities ?? []);
        },
        registerDisposable: track,
        setInterval: (fn, ms) => {
            const timer = setInterval(fn, ms);
            timer.unref();
            track(`interval:${addon.id}`, () => clearInterval(timer));
            return timer;
        },
        setTimeout: (fn, ms) => {
            const timer = setTimeout(fn, ms);
            timer.unref();
            track(`timeout:${addon.id}`, () => clearTimeout(timer));
            return timer;
        },
    };
}

/** 같은 add-on 의 정지·재개를 앞 작업이 끝난 뒤에 돌린다 */
function serialize<T>(record: AddonLifecycleRecord, op: () => Promise<T>): Promise<T> {
    const next = record.queue.then(op);
    record.queue = next.then(() => undefined, () => undefined);
    return next;
}

/**
 * 런타임 진입점을 시간 제한 안에서 부르고, 돌려준 handle 을 기록한다. 실패·시간 초과는 throw — 호출부(bootAddons)가
 * `releaseAddonResources` 로 회수한다. 시간 초과면 host.signal 을 끊어 늦게 끝나는 시작도 멈추게 한다.
 */
export async function startAddonRuntime(
    addon: BuiltinAddon,
    start: (host: AddonRuntimeHost) => Promise<void | AddonRuntimeHandle>,
    timeoutMs: number = ADDON_START_TIMEOUT_MS,
): Promise<void> {
    const record = createRecord(addon.id);
    const signal = record.controller.signal;
    // 상한 값이 잘못되면 상한 없이 시작한다(종전 동작) — 잘못된 env 하나로 모든 add-on 이 실패하지 않게
    if (!isTimerDelay(timeoutMs)) logger.warn(`add-on 시작 상한 값이 잘못됨(${timeoutMs}) — '${addon.id}' 는 상한 없이 시작`);
    const timeout = isTimerDelay(timeoutMs) ? AbortSignal.timeout(timeoutMs) : undefined;
    const onTimeout = (): void => { record.controller.abort(new Error(`시작 시간 초과(${timeoutMs}ms)`)); };
    timeout?.addEventListener('abort', onTimeout, { once: true });
    try {
        const result = await new Promise<void | AddonRuntimeHandle>((resolve, reject) => {
            const onAbort = (): void => { reject(signal.reason instanceof Error ? signal.reason : new Error(String(signal.reason))); };
            signal.addEventListener('abort', onAbort, { once: true });
            start(hostFor(addon, record)).then(
                (value) => {
                    signal.removeEventListener('abort', onAbort);
                    // 시간 초과 뒤 늦게 돌아온 handle 은 아무도 정지하지 않는다 — 여기서 즉시 정지시킨다
                    if (signal.aborted && isAddonRuntimeHandle(value)) {
                        const work = Promise.resolve().then(() => value.stop({ drain: false, signal: AbortSignal.abort() }));
                        void settleWithin(work, waitLimit(ADDON_DRAIN_TIMEOUT_MS, addon.id), addon.id, '늦은 시작 handle 정지');
                    }
                    resolve(value);
                },
                (err: unknown) => { signal.removeEventListener('abort', onAbort); reject(err); },
            );
        });
        record.handle = isAddonRuntimeHandle(result) ? result : null;
    } finally {
        timeout?.removeEventListener('abort', onTimeout);
    }
}

/**
 * 정리 함수를 등록 역순으로 한 번씩 부른다 — 하나마다 `limit()` 이 준 signal 이 끊길 때까지만 기다리고, 던지거나 넘어도 나머지는 계속.
 * 이미 끊긴 signal(마감 지남)이면 부르기만 하고 기다리지 않는다(경고). 상한 안에 끝난 이름을 돌려준다.
 */
async function runDisposables(record: AddonLifecycleRecord, limit: () => AbortSignal): Promise<string[]> {
    const list = record.disposables.splice(0).reverse();
    const done: string[] = [];
    for (const item of list) {
        const work = Promise.resolve().then(() => item.dispose());
        const outcome = await settleWithin(work, limit(), record.addonId, `정리 '${item.name}'`);
        if (outcome === 'done') done.push(item.name);
    }
    return done;
}

/**
 * 시작 실패 보상 — handle 즉시 정지(drain=false) → 정리 함수(역순) → 기여 도구 → capability 를 회수하고 host.signal 을 끊는다.
 * stop·정리 함수 하나하나는 `timeoutMs`(기본 `ADDON_DRAIN_TIMEOUT_MS`) 상한 안에서만 기다린다 — 끝나지 않는 런타임이
 * 부팅 루프(뒤의 add-on 시작)를 붙잡지 않게. 두 번 불러도 안전하다(비운 목록·지운 기여는 0건). 회수한 항목을 돌려준다(로그·테스트용).
 */
export async function releaseAddonResources(
    addonId: string,
    timeoutMs: number = ADDON_DRAIN_TIMEOUT_MS,
): Promise<{ disposed: string[]; tools: number; capabilities: string[] }> {
    const record = records.get(addonId);
    if (record?.handle) {
        const handle = record.handle;
        record.handle = null;
        // 런타임에는 이미 끊긴 signal 로 즉시 취소를 알리고, 호스트는 상한 안에서만 기다린다
        const work = Promise.resolve().then(() => handle.stop({ drain: false, signal: AbortSignal.abort() }));
        await settleWithin(work, waitLimit(timeoutMs, addonId), addonId, '시작 실패 보상 정지');
    }
    const disposed = record ? await runDisposables(record, () => waitLimit(timeoutMs, addonId)) : [];
    if (record && !record.controller.signal.aborted) record.controller.abort(new Error('add-on 자원 회수'));
    const tools = unregisterToolContributions(addonId);
    const capabilities = getCapabilityRegistry().unregisterOwner(addonId);
    return { disposed, tools, capabilities };
}

/**
 * 작업(stop·정리 함수)을 signal 이 끊길 때까지만 기다린다 — 넘으면 경고만 남기고 돌아온다(stop 은 같은 signal 로 취소를 받는다).
 * 결과: done(끝남) · failed(던짐 — 경고 후 계속) · timeout(상한 초과).
 */
async function settleWithin(work: Promise<void>, signal: AbortSignal, addonId: string, what: string): Promise<'done' | 'failed' | 'timeout'> {
    let onAbort: (() => void) | undefined;
    const aborted = new Promise<'timeout'>((resolve) => {
        if (signal.aborted) { resolve('timeout'); return; }
        onAbort = () => resolve('timeout');
        signal.addEventListener('abort', onAbort, { once: true });
    });
    const finished = work.then(
        () => 'done' as const,
        (err: unknown) => { logger.warn(`add-on '${addonId}' ${what} 오류(계속): ${errorMessage(err)}`); return 'failed' as const; },
    );
    const outcome = await Promise.race([finished, aborted]);
    if (onAbort) signal.removeEventListener('abort', onAbort);
    if (outcome === 'timeout') logger.warn(`add-on '${addonId}' ${what} 시간 초과 — 더 기다리지 않는다`);
    return outcome;
}

export type AddonStopOutcome = 'stopped' | 'already_stopped' | 'not_running' | 'nothing_to_stop';

/**
 * 정지 — `ready` 인 add-on 의 handle.stop 을 시간 제한(`ADDON_DRAIN_TIMEOUT_MS`) 안에서 부르고 `stopped` 로 둔다.
 * handle 이 없는 기존 진입점은 실제로 멈출 것이 없어 상태를 바꾸지 않는다(`ready` 유지 → `nothing_to_stop`, 콘텐츠 팩과 같은 규칙).
 * host.signal·정리 함수는 건드리지 않는다(재개할 수 있어야 한다).
 * `deadline` 을 주면(전체 정지) `timeoutMs` 대신 그 마감 signal 로 기다리고 취소를 알린다.
 */
export function stopAddon(
    addonId: string,
    opts: { drain: boolean; timeoutMs?: number; deadline?: AbortSignal },
): Promise<AddonStopOutcome> {
    const record = records.get(addonId);
    if (!record) return Promise.resolve('not_running');
    return serialize(record, async (): Promise<AddonStopOutcome> => {
        const status = getAddonRuntimeStatus(addonId).status;
        if (status === 'stopped') return 'already_stopped';
        if (status !== 'ready') return 'not_running';
        const handle = record.handle;
        if (!handle) return 'nothing_to_stop';
        setAddonRuntimeStatus(addonId, 'stopping');
        const timeoutMs = opts.timeoutMs ?? ADDON_DRAIN_TIMEOUT_MS;
        const signal = opts.deadline ?? waitLimit(timeoutMs, addonId);
        await settleWithin(Promise.resolve().then(() => handle.stop({ drain: opts.drain, signal })), signal, addonId, 'drain 정지');
        setAddonRuntimeStatus(addonId, 'stopped');
        logger.info(`add-on '${addonId}' 런타임 정지(${opts.drain ? `drain ≤${timeoutMs}ms` : '즉시'})`);
        return 'stopped';
    });
}

export type AddonResumeOutcome = 'resumed' | 'restart_required' | 'already_ready' | 'not_running';

/** 재개 — `stopped` 이고 handle.resume 이 있으면 불러 `ready` 로. 없거나 실패하면 `restart_required`(상태는 stopped 유지) */
export function resumeAddon(addonId: string): Promise<AddonResumeOutcome> {
    const record = records.get(addonId);
    if (!record) return Promise.resolve('not_running');
    return serialize(record, async (): Promise<AddonResumeOutcome> => {
        const status = getAddonRuntimeStatus(addonId).status;
        if (status === 'ready') return 'already_ready';
        if (status !== 'stopped') return 'not_running';
        const handle = record.handle;
        if (!handle?.resume) return 'restart_required';
        try {
            await handle.resume();
        } catch (err) {
            logger.error(`add-on '${addonId}' 런타임 재개 실패 — 재시작으로 반영: ${errorMessage(err)}`);
            return 'restart_required';
        }
        setAddonRuntimeStatus(addonId, 'ready');
        logger.info(`add-on '${addonId}' 런타임 재개`);
        return 'resumed';
    });
}

/**
 * 프로세스 종료 — 모든 add-on 을 병렬로 정지한 뒤 host.signal 을 끊고 정리 함수를 회수한다.
 * `budgetMs` 는 정지(같은 add-on 의 앞선 정지·재개 대기 포함)와 정리 함수 전체를 합친 **단일 마감**이다 — 종료 단계의 상한이
 * 정확히 이 값이 되게. 마감이 지난 뒤의 정리 함수는 부르기만 하고 기다리지 않는다(경고). 기록은 그래도 비운다.
 * 기여 도구·capability 등록은 지우지 않는다(곧 프로세스가 끝난다 — 남은 요청 처리가 거절되지 않게).
 */
export async function stopAllAddons(opts: { drain: boolean; budgetMs: number }): Promise<void> {
    const all = [...records.values()];
    const deadline = waitLimit(opts.budgetMs, '전체 정지');
    await Promise.all(all.map((record) => settleWithin(
        stopAddon(record.addonId, { drain: opts.drain, timeoutMs: opts.budgetMs, deadline }).then(() => undefined),
        deadline, record.addonId, '종료 정지(대기 포함)',
    )));
    for (const record of all) {
        if (!record.controller.signal.aborted) record.controller.abort(new Error('프로세스 종료'));
        await runDisposables(record, () => deadline);
        // handle 없는 기록은 stopAddon 이 상태를 두지만, 종료는 타이머·정리 함수까지 회수했으므로 멈춘 것으로 둔다
        if (getAddonRuntimeStatus(record.addonId).status === 'ready') setAddonRuntimeStatus(record.addonId, 'stopped');
    }
}

/** 관리 API·테스트가 읽는다 */
export function getAddonLifecycleRecord(addonId: string): Readonly<AddonLifecycleRecord> | undefined {
    return records.get(addonId);
}

export type AddonRuntimeTransition = 'stopped' | 'resumed' | 'restart_required' | 'unchanged' | 'not_loaded';

/**
 * 관리자 의도를 **이 프로세스의** 런타임에 반영한다(관리자 토글 라우트가 부른다).
 * - 런타임 진입점(`entry.runtime`)이 없다고 레지스트리가 확인한 add-on(콘텐츠 팩 등)은 적용할 런타임이 없다 → `unchanged`
 *   (라우트·훅 게이트는 새 의도를 바로 본다). 레지스트리에 없는 id 는 진입점이 있을 수 있다고 보고 아래 규칙을 따른다.
 * - disabled: drain 정지(상한 `ADDON_DRAIN_TIMEOUT_MS`) → `stopped`. 이 프로세스가 세우지 않았으면 `not_loaded`.
 *             handle 이 없는 런타임(void 진입점)은 멈출 것이 없어 `unchanged`(ready 유지 — 켜기도 `unchanged`).
 * - enabled : resume 이 있으면 `resumed`, 없거나 실패하면 `restart_required`, 이미 ready 면 `unchanged`,
 *             이 프로세스가 세우지 않았으면(부팅 때 꺼져 있었다) `restart_required`.
 * 다른 프로세스의 런타임은 바꾸지 못한다 — 재시작으로 반영한다(결정 D1, 운영은 단일 fork).
 */
export async function applyDesiredState(addonId: string, desired: AddonDesiredState): Promise<AddonRuntimeTransition> {
    const def = listBuiltinAddonDefs().find((a) => a.id === addonId);
    if (def && !def.manifest.entry?.runtime) return 'unchanged';
    if (desired === 'disabled') {
        const outcome = await stopAddon(addonId, { drain: true });
        if (outcome === 'nothing_to_stop') return 'unchanged';
        return outcome === 'not_running' ? 'not_loaded' : 'stopped';
    }
    const outcome = await resumeAddon(addonId);
    if (outcome === 'resumed') return 'resumed';
    if (outcome === 'already_ready') return 'unchanged';
    return 'restart_required';
}

/** 테스트 정리용 */
export function resetAddonLifecyclesForTest(): void {
    records.clear();
}
