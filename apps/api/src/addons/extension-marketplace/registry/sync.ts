/**
 * 레지스트리 증분 동기화 — tick 한 번의 일. 실패는 상태에 남기고 던지지 않는다(fail-open — 갤러리·판정과 무관).
 *
 * 순서: ① 플래그 OFF → 아무것도 하지 않는다(외부 요청 0·DB 0) ② 백오프 중이면 건너뜀 ③ 진행 중인 커서가 없고 아직 주기가
 * 안 됐으면 건너뜀 ④ 페이지를 받아 항목을 반영하고 커서를 페이지마다 저장(재시작해도 이어받는다) ⑤ 마지막 페이지면
 * 기준 시각(watermark)을 "이번 실행 시작 − 여유" 로 올리고 커서를 비운다. 다음 실행은 `updated_since=watermark` 증분이다.
 * 429 는 Retry-After 만큼, 그 밖의 실패는 지수 백오프로 쉰다(커서는 남겨 이어받는다).
 *
 * @module addons/extension-marketplace/registry/sync
 */
import { createLogger } from '../../../utils/logger';
import { REGISTRY_LIMITS } from './constants';
import { fetchRegistryPage, type RegistryFetch } from './registry-client';
import type { RegistryRepository, SyncState } from './registry-repository';
import { parseRegistryItem } from './server-json';

const logger = createLogger('ExtensionMarketplaceRegistry');

export interface SyncDeps {
    enabled: () => boolean;
    repo: () => RegistryRepository;
    fetch: RegistryFetch;
    baseUrl: string;
    now: () => number;
    signal?: AbortSignal;
}

export type SyncOutcome =
    | { status: 'disabled' }
    | { status: 'backoff'; until: string }
    | { status: 'not_due' }
    | { status: 'partial'; pages: number; stats: SyncStats }
    | { status: 'complete'; pages: number; stats: SyncStats }
    | { status: 'rate_limited'; retryAfterMs: number; stats: SyncStats }
    | { status: 'failed'; message: string; stats: SyncStats };

export interface SyncStats {
    received: number;
    inserted: number;
    updated: number;
    ignored: number;
    unknownSchema: number;
    malformed: number;
}

function emptyStats(): SyncStats {
    return { received: 0, inserted: 0, updated: 0, ignored: 0, unknownSchema: 0, malformed: 0 };
}

export function backoffMs(failureCount: number): number {
    const exp = REGISTRY_LIMITS.BACKOFF_BASE_MS * 2 ** Math.max(0, Math.min(failureCount - 1, 20));
    return Math.min(REGISTRY_LIMITS.BACKOFF_MAX_MS, exp);
}

function isDue(state: SyncState, now: number, force: boolean): boolean {
    if (state.cursor) return true;
    if (force || !state.lastSuccessAt) return true;
    return now - Date.parse(state.lastSuccessAt) >= REGISTRY_LIMITS.SYNC_INTERVAL_MS;
}

function addStats(total: SyncStats, add: SyncStats): SyncStats {
    return {
        received: total.received + add.received, inserted: total.inserted + add.inserted, updated: total.updated + add.updated,
        ignored: total.ignored + add.ignored, unknownSchema: total.unknownSchema + add.unknownSchema, malformed: total.malformed + add.malformed,
    };
}

export async function runRegistrySync(deps: SyncDeps, opts: { force?: boolean } = {}): Promise<SyncOutcome> {
    // 플래그가 꺼져 있으면 저장소도 만들지 않는다 — 외부 요청 0
    if (!deps.enabled()) return { status: 'disabled' };
    const repo = deps.repo();
    const now = deps.now();
    const state = await repo.getState();
    if (state.backoffUntil && Date.parse(state.backoffUntil) > now) return { status: 'backoff', until: state.backoffUntil };
    if (!isDue(state, now, opts.force === true)) return { status: 'not_due' };

    const resuming = Boolean(state.cursor);
    const runStartedAt = resuming && state.runStartedAt ? state.runStartedAt : new Date(now).toISOString();
    const updatedSince = resuming ? state.runUpdatedSince : state.watermark;
    let cursor = state.cursor;
    let stats: SyncStats = resuming ? { ...emptyStats(), ...state.lastStats } : emptyStats();
    await repo.patchState({ lastAttemptAt: new Date(now).toISOString(), runStartedAt, runUpdatedSince: updatedSince });

    for (let page = 0; page < REGISTRY_LIMITS.PAGES_PER_TICK; page += 1) {
        if (deps.signal?.aborted) return { status: 'partial', pages: page, stats };
        const res = await fetchRegistryPage({ baseUrl: deps.baseUrl, cursor, updatedSince, signal: deps.signal }, deps.fetch, deps.now);
        if (res.kind === 'rate_limited') {
            const until = new Date(deps.now() + res.retryAfterMs).toISOString();
            await repo.patchState({ backoffUntil: until, lastError: `429 — ${Math.round(res.retryAfterMs / 1000)}초 뒤 재시도`, lastStats: { ...stats } });
            logger.warn(`MCP Registry 429 — ${until} 까지 쉰다(커서 유지)`);
            return { status: 'rate_limited', retryAfterMs: res.retryAfterMs, stats };
        }
        if (res.kind === 'failed') {
            const failureCount = state.failureCount + 1;
            const until = new Date(deps.now() + backoffMs(failureCount)).toISOString();
            await repo.patchState({ failureCount, backoffUntil: until, lastError: res.message.slice(0, 500), lastStats: { ...stats } });
            logger.warn(`MCP Registry 동기화 실패(${failureCount}회 연속, ${until} 까지 쉼): ${res.message}`);
            return { status: 'failed', message: res.message, stats };
        }
        const pageStats = emptyStats();
        for (const item of res.items) {
            pageStats.received += 1;
            const parsed = parseRegistryItem(item);
            if (!parsed.ok) {
                if (parsed.reason === 'unknown_schema') pageStats.unknownSchema += 1;
                else pageStats.malformed += 1;
                continue;
            }
            pageStats[await repo.applyEntry(parsed.entry)] += 1;
        }
        stats = addStats(stats, pageStats);
        cursor = res.nextCursor;
        if (!cursor) {
            const watermark = new Date(Date.parse(runStartedAt) - REGISTRY_LIMITS.WATERMARK_SKEW_MS).toISOString();
            await repo.patchState({
                cursor: null, runUpdatedSince: null, runStartedAt: null, watermark, lastSuccessAt: new Date(deps.now()).toISOString(),
                failureCount: 0, backoffUntil: null, lastError: null, lastStats: { ...stats },
            });
            logger.info(`MCP Registry 동기화 완료 — 받음 ${stats.received}, 새 ${stats.inserted}, 갱신 ${stats.updated}, 모르는 스키마 ${stats.unknownSchema}`);
            return { status: 'complete', pages: page + 1, stats };
        }
        await repo.patchState({ cursor, lastStats: { ...stats } });
    }
    return { status: 'partial', pages: REGISTRY_LIMITS.PAGES_PER_TICK, stats };
}
