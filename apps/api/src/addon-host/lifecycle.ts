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
import type { BuiltinAddon } from './builtin-registry';
import { isAddonRuntimeHandle, type AddonRuntimeHandle, type AddonRuntimeHost } from './lifecycle-types';

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

/** Node 타이머(`AbortSignal.timeout`)가 받는 지연 상한(ms) — 넘거나 정수가 아니면 RangeError 를 던진다 */
const MAX_TIMER_DELAY_MS = 2 ** 32 - 1;

/** env 오입력(NaN·음수)이 `AbortSignal.timeout` 에서 던지지 않게 미리 거른다 */
function isTimerDelay(ms: number): boolean {
    return Number.isInteger(ms) && ms >= 0 && ms <= MAX_TIMER_DELAY_MS;
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
    const track = (name: string, dispose: () => void | Promise<void>): void => { record.disposables.push({ name, dispose }); };
    return {
        owner,
        signal: record.controller.signal,
        registerCapabilities: (entries) => registerCapabilities(owner, entries, addon.manifest.provides?.capabilities ?? []),
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
                (value) => { signal.removeEventListener('abort', onAbort); resolve(value); },
                (err: unknown) => { signal.removeEventListener('abort', onAbort); reject(err); },
            );
        });
        record.handle = isAddonRuntimeHandle(result) ? result : null;
    } finally {
        timeout?.removeEventListener('abort', onTimeout);
    }
}

/** 정리 함수를 등록 역순으로 한 번씩 부른다 — 하나가 던져도 나머지는 계속. 부른 이름을 돌려준다 */
async function runDisposables(record: AddonLifecycleRecord): Promise<string[]> {
    const list = record.disposables.splice(0).reverse();
    const done: string[] = [];
    for (const item of list) {
        try {
            await item.dispose();
            done.push(item.name);
        } catch (err) {
            logger.warn(`add-on '${record.addonId}' 정리 '${item.name}' 실패(계속): ${errorMessage(err)}`);
        }
    }
    return done;
}

/**
 * 시작 실패 보상 — handle 즉시 정지(drain=false) → 정리 함수(역순) → 기여 도구 → capability 를 회수하고 host.signal 을 끊는다.
 * 두 번 불러도 안전하다(비운 목록·지운 기여는 0건). 회수한 항목을 돌려준다(로그·테스트용).
 */
export async function releaseAddonResources(addonId: string): Promise<{ disposed: string[]; tools: number; capabilities: string[] }> {
    const record = records.get(addonId);
    if (record?.handle) {
        const handle = record.handle;
        record.handle = null;
        try {
            await handle.stop({ drain: false, signal: AbortSignal.abort() });
        } catch (err) {
            logger.warn(`add-on '${addonId}' 시작 실패 보상 중 정지 실패(계속): ${errorMessage(err)}`);
        }
    }
    const disposed = record ? await runDisposables(record) : [];
    if (record && !record.controller.signal.aborted) record.controller.abort(new Error('add-on 자원 회수'));
    const tools = unregisterToolContributions(addonId);
    const capabilities = getCapabilityRegistry().unregisterOwner(addonId);
    return { disposed, tools, capabilities };
}

/** handle.stop 을 signal 이 끊길 때까지만 기다린다 — 넘으면 경고만 남기고 돌아온다(런타임은 같은 signal 로 취소를 받는다) */
async function settleWithin(work: Promise<void>, signal: AbortSignal, addonId: string): Promise<void> {
    let onAbort: (() => void) | undefined;
    const aborted = new Promise<'aborted'>((resolve) => {
        if (signal.aborted) { resolve('aborted'); return; }
        onAbort = () => resolve('aborted');
        signal.addEventListener('abort', onAbort, { once: true });
    });
    const finished = work.then(
        () => 'done' as const,
        (err: unknown) => { logger.warn(`add-on '${addonId}' 정지 중 오류(정지로 간주): ${errorMessage(err)}`); return 'done' as const; },
    );
    const outcome = await Promise.race([finished, aborted]);
    if (onAbort) signal.removeEventListener('abort', onAbort);
    if (outcome === 'aborted') logger.warn(`add-on '${addonId}' drain 시간 초과 — 취소 신호를 보냈고 더 기다리지 않는다`);
}

export type AddonStopOutcome = 'stopped' | 'already_stopped' | 'not_running';

/**
 * 정지 — `ready` 인 add-on 의 handle.stop 을 시간 제한(`ADDON_DRAIN_TIMEOUT_MS`) 안에서 부르고 `stopped` 로 둔다.
 * handle 이 없는 기존 진입점은 상태만 바꾼다. host.signal·정리 함수는 건드리지 않는다(재개할 수 있어야 한다).
 */
export function stopAddon(addonId: string, opts: { drain: boolean; timeoutMs?: number }): Promise<AddonStopOutcome> {
    const record = records.get(addonId);
    if (!record) return Promise.resolve('not_running');
    return serialize(record, async (): Promise<AddonStopOutcome> => {
        const status = getAddonRuntimeStatus(addonId).status;
        if (status === 'stopped') return 'already_stopped';
        if (status !== 'ready') return 'not_running';
        setAddonRuntimeStatus(addonId, 'stopping');
        const timeoutMs = opts.timeoutMs ?? ADDON_DRAIN_TIMEOUT_MS;
        const handle = record.handle;
        if (handle) {
            // 상한 값이 잘못되면 기다리지 않고 바로 취소한다 — 'stopping' 에 멈추거나 종료가 끝없이 기다리지 않게
            if (!isTimerDelay(timeoutMs)) logger.warn(`add-on drain 상한 값이 잘못됨(${timeoutMs}) — '${addonId}' 즉시 취소`);
            const signal = isTimerDelay(timeoutMs) ? AbortSignal.timeout(timeoutMs) : AbortSignal.abort();
            await settleWithin(Promise.resolve().then(() => handle.stop({ drain: opts.drain, signal })), signal, addonId);
        }
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
 * 프로세스 종료 — 모든 add-on 을 예산 안에서 병렬로 정지한 뒤 host.signal 을 끊고 정리 함수를 회수한다.
 * 기여 도구·capability 등록은 지우지 않는다(곧 프로세스가 끝난다 — 남은 요청 처리가 거절되지 않게).
 */
export async function stopAllAddons(opts: { drain: boolean; budgetMs: number }): Promise<void> {
    const all = [...records.values()];
    await Promise.all(all.map((record) => stopAddon(record.addonId, { drain: opts.drain, timeoutMs: opts.budgetMs })));
    for (const record of all) {
        if (!record.controller.signal.aborted) record.controller.abort(new Error('프로세스 종료'));
        await runDisposables(record);
    }
}

/** 관리 API·테스트가 읽는다 */
export function getAddonLifecycleRecord(addonId: string): Readonly<AddonLifecycleRecord> | undefined {
    return records.get(addonId);
}

/** 테스트 정리용 */
export function resetAddonLifecyclesForTest(): void {
    records.clear();
}
