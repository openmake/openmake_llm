/**
 * 증분 동기화(sync) — 플래그 OFF 외부 요청 0 · 커서 이어받기 · watermark 증분 · 429 Retry-After · 실패 백오프 · 모르는 스키마 건너뜀.
 * 저장소는 메모리 가짜(규칙은 registry-db 테스트가 실 DB 로 본다).
 */
import { REGISTRY_LIMITS } from '../registry/constants';
import type { RegistryRepository, SyncState, SyncStatePatch } from '../registry/registry-repository';
import type { RegistryEntry } from '../registry/server-json';
import { backoffMs, runRegistrySync, type SyncDeps } from '../registry/sync';
import { pageResponse, registryItem } from './registry-fixtures';

class FakeRepo {
    state: SyncState = {
        cursor: null, runUpdatedSince: null, runStartedAt: null, watermark: null, lastAttemptAt: null, lastSuccessAt: null,
        backoffUntil: null, failureCount: 0, lastError: null, lastStats: {},
    };
    entries = new Map<string, RegistryEntry>();
    async getState() { return { ...this.state }; }
    async patchState(p: SyncStatePatch) { this.state = { ...this.state, ...Object.fromEntries(Object.entries(p).filter(([, v]) => v !== undefined)) }; }
    async applyEntry(e: RegistryEntry) {
        if (!e.isLatest) return 'ignored' as const;
        const had = this.entries.has(e.serverName);
        this.entries.set(e.serverName, e);
        return had ? 'updated' as const : 'inserted' as const;
    }
}

const NOW = Date.parse('2026-11-28T00:00:00Z');

function deps(repo: FakeRepo, fetch: jest.Mock, over: Partial<SyncDeps> = {}): SyncDeps {
    return { enabled: () => true, repo: () => repo as unknown as RegistryRepository, fetch, baseUrl: 'https://r.example', now: () => NOW, ...over };
}

function urlOf(call: unknown[]): URL {
    return new URL(String(call[0]));
}

describe('runRegistrySync', () => {
    it('플래그 OFF — 요청도 저장소도 건드리지 않는다(외부 호출 0)', async () => {
        const fetch = jest.fn();
        const repoFactory = jest.fn();
        const r = await runRegistrySync({ enabled: () => false, repo: repoFactory, fetch, baseUrl: 'https://r.example', now: () => NOW });
        expect(r).toEqual({ status: 'disabled' });
        expect(fetch).not.toHaveBeenCalled();
        expect(repoFactory).not.toHaveBeenCalled();
    });

    it('전체 동기화 — 커서로 페이지를 잇고, 끝나면 watermark = 시작 − 여유, 모르는 스키마는 건너뛴다', async () => {
        const repo = new FakeRepo();
        const fetch = jest.fn()
            .mockResolvedValueOnce(pageResponse([registryItem(), registryItem({ $schema: 'https://x/2025-09-29/server.schema.json', name: 'a.b/old' })], 'c1'))
            .mockResolvedValueOnce(pageResponse([registryItem({ name: 'io.github.acme/other' })], null));
        const r = await runRegistrySync(deps(repo, fetch));
        expect(r).toMatchObject({ status: 'complete', pages: 2, stats: { received: 3, inserted: 2, unknownSchema: 1 } });
        expect(urlOf(fetch.mock.calls[0]).searchParams.get('version')).toBe('latest');
        expect(urlOf(fetch.mock.calls[1]).searchParams.get('cursor')).toBe('c1');
        expect(repo.state.cursor).toBeNull();
        expect(repo.state.watermark).toBe(new Date(NOW - REGISTRY_LIMITS.WATERMARK_SKEW_MS).toISOString());
        expect(repo.state.lastSuccessAt).toBe(new Date(NOW).toISOString());
        expect([...repo.entries.keys()].sort()).toEqual(['io.github.acme/other', 'io.github.acme/weather']);
    });

    it('주기 전이면 요청하지 않는다, force 면 updated_since 증분', async () => {
        const repo = new FakeRepo();
        repo.state.lastSuccessAt = new Date(NOW - 1000).toISOString();
        repo.state.watermark = '2026-11-27T00:00:00.000Z';
        const fetch = jest.fn().mockResolvedValue(pageResponse([], null));
        expect(await runRegistrySync(deps(repo, fetch))).toEqual({ status: 'not_due' });
        expect(fetch).not.toHaveBeenCalled();
        await runRegistrySync(deps(repo, fetch), { force: true });
        expect(urlOf(fetch.mock.calls[0]).searchParams.get('updated_since')).toBe('2026-11-27T00:00:00.000Z');
    });

    it('페이지 상한에 닿으면 커서를 저장하고, 다음 tick 이 같은 기준으로 이어받는다', async () => {
        const repo = new FakeRepo();
        repo.state.watermark = '2026-11-20T00:00:00.000Z';
        let n = 0;
        const fetch = jest.fn().mockImplementation(async () => pageResponse([registryItem({ name: `a.b/s${n}` })], `c${++n}`));
        const first = await runRegistrySync(deps(repo, fetch), { force: true });
        expect(first).toMatchObject({ status: 'partial', pages: REGISTRY_LIMITS.PAGES_PER_TICK });
        expect(repo.state.cursor).toBe(`c${REGISTRY_LIMITS.PAGES_PER_TICK}`);
        expect(repo.state.runUpdatedSince).toBe('2026-11-20T00:00:00.000Z');

        fetch.mockReset();
        fetch.mockResolvedValueOnce(pageResponse([], null));
        // 주기 전이어도(진행 중 커서) 이어받는다, 실행 시작 시각은 처음 것을 유지
        const later = NOW + 60_000;
        const second = await runRegistrySync(deps(repo, fetch, { now: () => later }));
        expect(second).toMatchObject({ status: 'complete' });
        const u = urlOf(fetch.mock.calls[0]);
        expect(u.searchParams.get('cursor')).toBe(`c${REGISTRY_LIMITS.PAGES_PER_TICK}`);
        expect(u.searchParams.get('updated_since')).toBe('2026-11-20T00:00:00.000Z');
        expect(repo.state.watermark).toBe(new Date(NOW - REGISTRY_LIMITS.WATERMARK_SKEW_MS).toISOString());
        expect(second.status === 'complete' && second.stats.received).toBe(REGISTRY_LIMITS.PAGES_PER_TICK);
    });

    it('429 — Retry-After 만큼 쉬고 커서를 남긴다, 쉬는 동안은 요청하지 않는다', async () => {
        const repo = new FakeRepo();
        const fetch = jest.fn()
            .mockResolvedValueOnce(pageResponse([registryItem()], 'c1'))
            .mockResolvedValueOnce(new Response('', { status: 429, headers: { 'retry-after': '120' } }));
        const r = await runRegistrySync(deps(repo, fetch));
        expect(r).toMatchObject({ status: 'rate_limited', retryAfterMs: 120_000 });
        expect(repo.state.cursor).toBe('c1');
        expect(repo.state.backoffUntil).toBe(new Date(NOW + 120_000).toISOString());
        fetch.mockClear();
        expect(await runRegistrySync(deps(repo, fetch, { now: () => NOW + 60_000 }))).toMatchObject({ status: 'backoff' });
        expect(fetch).not.toHaveBeenCalled();
    });

    it('실패는 지수 백오프(상한 있음), 성공하면 실패 횟수를 지운다', async () => {
        const repo = new FakeRepo();
        repo.state.failureCount = 2;
        const fetch = jest.fn().mockResolvedValueOnce(new Response('x', { status: 502 }));
        expect(await runRegistrySync(deps(repo, fetch))).toMatchObject({ status: 'failed', message: 'HTTP 502' });
        expect(repo.state.failureCount).toBe(3);
        expect(repo.state.backoffUntil).toBe(new Date(NOW + backoffMs(3)).toISOString());
        expect(backoffMs(50)).toBe(REGISTRY_LIMITS.BACKOFF_MAX_MS);

        fetch.mockResolvedValueOnce(pageResponse([], null));
        await runRegistrySync(deps(repo, fetch, { now: () => NOW + REGISTRY_LIMITS.BACKOFF_MAX_MS }));
        expect(repo.state).toMatchObject({ failureCount: 0, backoffUntil: null, lastError: null });
    });

    it('정지 신호가 오면 다음 페이지를 받지 않는다', async () => {
        const repo = new FakeRepo();
        const ctl = new AbortController();
        const fetch = jest.fn().mockImplementation(async () => { ctl.abort(); return pageResponse([], 'c1'); });
        const r = await runRegistrySync(deps(repo, fetch, { signal: ctl.signal }));
        expect(r).toMatchObject({ status: 'partial', pages: 1 });
        expect(fetch).toHaveBeenCalledTimes(1);
        expect(repo.state.cursor).toBe('c1');
    });
});
