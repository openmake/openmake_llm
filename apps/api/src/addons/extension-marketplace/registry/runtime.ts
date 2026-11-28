/**
 * MCP Registry 동기화 런타임 — 매니페스트 `entry.runtime`. 호스트 타이머(unref·종료 때 회수)로 tick 을 건다.
 *
 * tick 은 플래그(`EXT_MARKET_MCP_REGISTRY_SYNC`, 기본 OFF)를 매번 읽는다 — 꺼져 있으면 외부 요청도 DB 조회도 없다.
 * 한 번에 하나만 돈다(single-flight). 정지(관리자 토글·graceful shutdown)는 진행 중 요청을 abort 하고 새 tick 을 막는다.
 * 시작은 실패하지 않는다 — 이 add-on 의 판정 기능이 동기화 때문에 failed 가 되지 않게.
 *
 * @module addons/extension-marketplace/registry/runtime
 */
import type { AddonRuntimeHandle, AddonRuntimeHost } from '../../../addon-host';
import { readSettingValue } from '../../../config/env';
import { getPool } from '../../../runtime-ports/db-access';
import { createLogger } from '../../../utils/logger';
import { REGISTRY_LIMITS, REGISTRY_SOURCE_ID, REGISTRY_SYNC_FLAG, registryBaseUrl } from './constants';
import { defaultRegistryFetch, type RegistryFetch } from './registry-client';
import { RegistryRepository } from './registry-repository';
import { runRegistrySync, type SyncOutcome } from './sync';

const logger = createLogger('ExtensionMarketplaceRegistry');

/**
 * 관리자 빠른 작업(opt-in `EXT_MARKET_REGISTRY_QUICK_ACTIONS`, 2026-11-28, 기본 OFF) — 승인 + 카탈로그로 올리기를 한 번에,
 * 검색 결과를 관련도 순(이름·제목 일치 먼저)으로. 꺼져 있으면 라우트·정렬·상태 응답이 종전과 같다.
 */
export const REGISTRY_QUICK_ACTIONS_FLAG = 'EXT_MARKET_REGISTRY_QUICK_ACTIONS';
export function registryQuickActionsEnabled(): boolean {
    return readSettingValue(REGISTRY_QUICK_ACTIONS_FLAG) === 'true';
}

export function registrySyncEnabled(): boolean {
    return readSettingValue(REGISTRY_SYNC_FLAG) === 'true';
}

let inflight: Promise<SyncOutcome> | null = null;
let controller: AbortController | null = null;
let stopped = false;

/** 테스트가 요청 함수를 바꾼다 */
let fetchImpl: RegistryFetch = defaultRegistryFetch;
export function setRegistryFetchForTest(f: RegistryFetch | null): void {
    fetchImpl = f ?? defaultRegistryFetch;
}

/** tick 1회(또는 관리자 "지금 동기화" — force 면 주기를 기다리지 않는다). 이미 돌고 있으면 그 결과를 기다린다 */
export function triggerRegistrySync(opts: { force?: boolean } = {}): Promise<SyncOutcome> {
    if (inflight) return inflight;
    if (stopped || !registrySyncEnabled()) return Promise.resolve({ status: 'disabled' });
    controller = new AbortController();
    const signal = controller.signal;
    inflight = runRegistrySync({
        enabled: registrySyncEnabled,
        repo: () => new RegistryRepository(getPool(), REGISTRY_SOURCE_ID),
        fetch: fetchImpl,
        baseUrl: registryBaseUrl(),
        now: Date.now,
        signal,
    }, opts).catch((err): SyncOutcome => {
        const message = err instanceof Error ? err.message : String(err);
        logger.warn(`MCP Registry 동기화 tick 오류(무시): ${message}`);
        return { status: 'failed', message, stats: { received: 0, inserted: 0, updated: 0, ignored: 0, unknownSchema: 0, malformed: 0 } };
    }).finally(() => {
        inflight = null;
        controller = null;
    });
    return inflight;
}

function tick(): void {
    void triggerRegistrySync();
}

export async function startRegistryRuntime(host: AddonRuntimeHost): Promise<AddonRuntimeHandle> {
    stopped = false;
    host.setTimeout(tick, REGISTRY_LIMITS.FIRST_TICK_DELAY_MS);
    host.setInterval(tick, REGISTRY_LIMITS.TICK_MS);
    host.registerDisposable('market-registry-sync', () => stopRegistryRuntime());
    return {
        async stop(opts) {
            stopped = true;
            // 페이지마다 커서를 저장하므로 끊어도 다음에 이어받는다 — drain 이면 시간 제한(signal)까지만 기다린다
            if (!opts.drain || opts.signal.aborted) controller?.abort();
            else opts.signal.addEventListener('abort', () => controller?.abort(), { once: true });
            if (inflight) await inflight.catch(() => undefined);
        },
        async resume() {
            stopped = false;
        },
        health() {
            if (stopped) return { status: inflight ? 'draining' : 'stopped' };
            return { status: 'running', inflight: inflight ? 1 : 0 };
        },
    };
}

/** 정리 — 진행 중 요청을 끊고 새 tick 을 막는다(타이머는 호스트가 회수한다) */
export async function stopRegistryRuntime(): Promise<void> {
    stopped = true;
    controller?.abort();
    if (inflight) await inflight.catch(() => undefined);
}

/** 테스트 전용 — 모듈 상태 초기화 */
export function resetRegistryRuntimeForTest(): void {
    stopped = false;
    inflight = null;
    controller = null;
    fetchImpl = defaultRegistryFetch;
}
