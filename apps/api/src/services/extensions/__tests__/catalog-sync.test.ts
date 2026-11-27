/**
 * 확장 카탈로그 원본 동기화(M4) — 저장 토큰 사용·결과 기록·사유 마스킹·주기 동기화(opt-in)·백오프·타이머 수명.
 */
import { resetConfig } from '../../../config/env';
import { encryptToken } from '../../../utils/token-crypto';
import { normalizeCatalogSubpath } from '../../../config/extension-catalog-sync';
import {
    syncCatalogSource,
    runCatalogAutoSyncTick,
    classifySyncError,
    sanitizeSyncError,
    effectiveIntervalMs,
    isDue,
    startCatalogAutoSync,
    stopCatalogAutoSync,
    isCatalogAutoSyncRunning,
    resetCatalogAutoSyncState,
    type CatalogSyncDeps,
} from '../catalog-sync';
import type { ExtensionCatalogRow } from '../../../data/repositories/extension-catalog-repository';
import { CatalogIndexFallbackError } from '../../../agents/git-ingest/catalog-index';

const KEYS = ['EXTENSION_CATALOG_AUTO_SYNC_ENABLED', 'EXTENSION_CATALOG_INDEX_ENABLED', 'EXTENSION_CATALOG_SYNC_INTERVAL_MS', 'TOKEN_ENCRYPTION_KEY'] as const;
const ORIGINAL = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
const HOUR = 60 * 60 * 1000;
const SNAPSHOT = { name: 'm', description: null, plugins: [{ name: 'p' }] };

function row(over: Partial<ExtensionCatalogRow> = {}): ExtensionCatalogRow {
    return {
        id: 'c1', url: 'https://github.com/acme/market', name: 'm', description: null, plugins: [],
        enabled: true, added_by: null, last_synced_at: new Date(0), created_at: new Date(0), updated_at: new Date(0),
        ...over,
    };
}

function deps(rows: ExtensionCatalogRow[] = [row()]) {
    const d = {
        repo: {
            listEnabled: jest.fn(async () => rows),
            updateSnapshot: jest.fn(async (id: string) => rows.find((r) => r.id === id) ?? null),
            recordSyncResult: jest.fn(async () => undefined),
        },
        service: {
            fetchCatalogSnapshot: jest.fn(async (..._args: unknown[]) => SNAPSHOT),
            translateCatalogSnapshot: jest.fn(async () => undefined),
        },
    };
    return d as typeof d & CatalogSyncDeps;
}

beforeEach(() => {
    process.env.TOKEN_ENCRYPTION_KEY = '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff';
    delete process.env.EXTENSION_CATALOG_AUTO_SYNC_ENABLED;
    delete process.env.EXTENSION_CATALOG_SYNC_INTERVAL_MS;
    delete process.env.EXTENSION_CATALOG_INDEX_ENABLED;
    resetConfig();
    resetCatalogAutoSyncState();
});
afterEach(() => {
    for (const k of KEYS) { if (ORIGINAL[k] === undefined) delete process.env[k]; else process.env[k] = ORIGINAL[k]; }
    resetConfig();
    resetCatalogAutoSyncState();
    jest.useRealTimers();
});

describe('syncCatalogSource', () => {
    it('요청 토큰이 없으면 저장된 원본 토큰(복호화)으로 받는다 · 하위 경로를 넘긴다 · ok 기록', async () => {
        const d = deps();
        const r = row({ credential_encrypted: encryptToken('ghp_storedsecret123'), source_subpath: 'plugins/market' });
        await syncCatalogSource(d, r, { userId: 'u1' });
        expect(d.service.fetchCatalogSnapshot).toHaveBeenCalledWith(r.url, 'ghp_storedsecret123', { userId: 'u1', action: 'catalog-sync' }, 'plugins/market');
        expect(d.repo.updateSnapshot).toHaveBeenCalledWith('c1', SNAPSHOT);
        expect(d.repo.recordSyncResult).toHaveBeenCalledWith('c1', 'ok', null);
    });

    it('요청 토큰이 저장 토큰보다 우선한다', async () => {
        const d = deps();
        await syncCatalogSource(d, row({ credential_encrypted: encryptToken('stored-token-x') }), { accessToken: 'request-token-y' });
        expect(d.service.fetchCatalogSnapshot.mock.calls[0][1]).toBe('request-token-y');
    });

    it('저장 토큰이 없으면 무인증·루트(종전 동작)', async () => {
        const d = deps();
        await syncCatalogSource(d, row());
        expect(d.service.fetchCatalogSnapshot.mock.calls[0][1]).toBeUndefined();
        expect(d.service.fetchCatalogSnapshot.mock.calls[0][3]).toBeNull();
    });

    it('실패: 사유를 기록하고 다시 던진다 — 기록·던지는 사유 어디에도 토큰 값이 없다', async () => {
        const d = deps();
        const token = 'ghp_leakcheck_abcdef123456';
        d.service.fetchCatalogSnapshot.mockRejectedValueOnce(new Error(`UPSTREAM_FETCH_FAIL: 500 https://x/?t=${token}`));
        const err = await syncCatalogSource(d, row({ credential_encrypted: encryptToken(token) })).catch((e: Error) => e);
        expect(err).toBeInstanceOf(Error);
        expect((err as Error).message).not.toContain(token);
        const [, status, reason] = d.repo.recordSyncResult.mock.calls[0] as unknown as [string, string, string];
        expect(status).toBe('error');
        expect(reason).not.toContain(token);
        expect(d.repo.updateSnapshot).not.toHaveBeenCalled();
    });

    it('GitHub rate limit 은 rate_limited 로 기록한다', async () => {
        const d = deps();
        d.service.fetchCatalogSnapshot.mockRejectedValueOnce(new Error('GITHUB_RATE_LIMITED: limit reset at 123'));
        await expect(syncCatalogSource(d, row())).rejects.toThrow('GITHUB_RATE_LIMITED');
        expect(d.repo.recordSyncResult).toHaveBeenCalledWith('c1', 'rate_limited', expect.stringContaining('GITHUB_RATE_LIMITED'));
    });
});

describe('PURE helpers', () => {
    it('classifySyncError', () => {
        expect(classifySyncError('GITHUB_RATE_LIMITED: x')).toBe('rate_limited');
        expect(classifySyncError('UPSTREAM_FETCH_FAIL: 429 /repos')).toBe('rate_limited');
        expect(classifySyncError('REPO_NOT_FOUND: /repos/a/b')).toBe('error');
    });

    it('sanitizeSyncError: 토큰 제거 + 길이 상한', () => {
        expect(sanitizeSyncError('fail tok-123456 here', 'tok-123456')).toBe('fail *** here');
        expect(sanitizeSyncError('x'.repeat(2000)).length).toBeLessThanOrEqual(500);
    });

    it('effectiveIntervalMs: 연속 실패 2^n, rate limit 은 한 단계 더, 상한', () => {
        expect(effectiveIntervalMs(HOUR)).toBe(HOUR);
        expect(effectiveIntervalMs(HOUR, { count: 1, rateLimited: false })).toBe(2 * HOUR);
        expect(effectiveIntervalMs(HOUR, { count: 1, rateLimited: true })).toBe(4 * HOUR);
        expect(effectiveIntervalMs(HOUR, { count: 20, rateLimited: false })).toBe(48 * HOUR);
    });

    it('isDue: 마지막 시도(없으면 마지막 성공) + 간격', () => {
        const now = 10 * HOUR;
        expect(isDue({ last_sync_attempt_at: new Date(now - HOUR), last_synced_at: new Date(0) }, now, 2 * HOUR)).toBe(false);
        expect(isDue({ last_sync_attempt_at: null, last_synced_at: new Date(now - 3 * HOUR) }, now, 2 * HOUR)).toBe(true);
    });

    it('normalizeCatalogSubpath: 정규화·거절', () => {
        expect(normalizeCatalogSubpath(undefined)).toBeNull();
        expect(normalizeCatalogSubpath('  ')).toBeNull();
        expect(normalizeCatalogSubpath('./plugins/market/')).toBe('plugins/market');
        expect(() => normalizeCatalogSubpath('../etc')).toThrow('INVALID_CATALOG_SUBPATH');
        expect(() => normalizeCatalogSubpath('a/../b')).toThrow('INVALID_CATALOG_SUBPATH');
        expect(() => normalizeCatalogSubpath('a\\b')).toThrow('INVALID_CATALOG_SUBPATH');
    });
});

describe('runCatalogAutoSyncTick (opt-in)', () => {
    it('플래그 OFF(기본): DB 조회·원격 호출 0', async () => {
        const d = deps();
        expect(await runCatalogAutoSyncTick(d)).toBe(0);
        expect(d.repo.listEnabled).not.toHaveBeenCalled();
        expect(d.service.fetchCatalogSnapshot).not.toHaveBeenCalled();
    });

    it('ON: 간격이 지난 원본만 동기화한다', async () => {
        process.env.EXTENSION_CATALOG_AUTO_SYNC_ENABLED = 'true';
        process.env.EXTENSION_CATALOG_SYNC_INTERVAL_MS = String(HOUR); resetConfig();
        const now = 100 * HOUR;
        const d = deps([
            row({ id: 'old', last_sync_attempt_at: new Date(now - 2 * HOUR) }),
            row({ id: 'fresh', last_sync_attempt_at: new Date(now - 10 * 60 * 1000) }),
        ]);
        expect(await runCatalogAutoSyncTick(d, now)).toBe(1);
        expect(d.repo.recordSyncResult).toHaveBeenCalledWith('old', 'ok', null);
        expect(d.repo.recordSyncResult).not.toHaveBeenCalledWith('fresh', expect.anything(), expect.anything());
    });

    it('ON: 실패한 원본은 다음 tick 에서 백오프로 건너뛴다', async () => {
        process.env.EXTENSION_CATALOG_AUTO_SYNC_ENABLED = 'true';
        process.env.EXTENSION_CATALOG_SYNC_INTERVAL_MS = String(HOUR); resetConfig();
        const now = 100 * HOUR;
        const r = row({ id: 'flaky', last_sync_attempt_at: new Date(now - 1.5 * HOUR) });
        const d = deps([r]);
        d.service.fetchCatalogSnapshot.mockRejectedValueOnce(new Error('UPSTREAM_FETCH_FAIL: 500'));
        expect(await runCatalogAutoSyncTick(d, now)).toBe(1);
        // 같은 마지막 시도 시각이라도 실패 1회 후 유효 간격은 2시간 — 1.5시간 지점에선 차례가 아니다
        expect(await runCatalogAutoSyncTick(d, now)).toBe(0);
    });

    it('ON: rate limit 을 만나면 그 tick 은 멈춘다', async () => {
        process.env.EXTENSION_CATALOG_AUTO_SYNC_ENABLED = 'true'; resetConfig();
        const d = deps([row({ id: 'a' }), row({ id: 'b' })]);
        d.service.fetchCatalogSnapshot.mockRejectedValueOnce(new Error('GITHUB_RATE_LIMITED: x'));
        expect(await runCatalogAutoSyncTick(d)).toBe(1);
        expect(d.service.fetchCatalogSnapshot).toHaveBeenCalledTimes(1);
    });
});

describe('타이머 수명', () => {
    it('start 는 한 번만 걸고 stop 이 푼다(graceful shutdown)', () => {
        jest.useFakeTimers();
        const factory = jest.fn(async () => deps());
        startCatalogAutoSync(factory);
        startCatalogAutoSync(factory);
        expect(isCatalogAutoSyncRunning()).toBe(true);
        stopCatalogAutoSync();
        expect(isCatalogAutoSyncRunning()).toBe(false);
    });

    it('플래그 OFF 면 tick 이 의존성(DB)을 만들지 않는다', () => {
        jest.useFakeTimers();
        const factory = jest.fn(async () => deps());
        startCatalogAutoSync(factory);
        jest.advanceTimersByTime(60 * 60 * 1000);
        expect(factory).not.toHaveBeenCalled();
    });
});

describe('정적 색인 우선 동기화 (M6, opt-in)', () => {
    const INDEX_URL = 'https://github.com/acme/market/releases/download/catalog-index/index.json';
    const INDEX_SNAPSHOT = { name: 'm', description: null, plugins: [{ name: 'from-index' }] };

    function indexDeps(impl: (...a: unknown[]) => Promise<unknown>) {
        const d = deps();
        (d.service as Record<string, unknown>).fetchCatalogSnapshotFromIndex = jest.fn(impl);
        return d as typeof d & { service: { fetchCatalogSnapshotFromIndex: jest.Mock } };
    }

    it('플래그 ON + index_url → 색인 하나로 동기화(종전 경로 미호출) · 경고 없음', async () => {
        process.env.EXTENSION_CATALOG_INDEX_ENABLED = 'true'; resetConfig();
        const d = indexDeps(async () => INDEX_SNAPSHOT);
        const out = await syncCatalogSource(d, row({ index_url: INDEX_URL }), { userId: 'u1' });
        expect(out.via).toBe('index');
        expect(d.service.fetchCatalogSnapshotFromIndex).toHaveBeenCalledTimes(1);
        expect(d.service.fetchCatalogSnapshotFromIndex).toHaveBeenCalledWith(INDEX_URL, 'https://github.com/acme/market', { userId: 'u1', action: 'catalog-sync' });
        expect(d.service.fetchCatalogSnapshot).not.toHaveBeenCalled();
        expect(d.repo.updateSnapshot).toHaveBeenCalledWith('c1', INDEX_SNAPSHOT);
        expect(d.repo.recordSyncResult).toHaveBeenCalledWith('c1', 'ok', null);
    });

    it('색인 해시 불일치 → 종전 방식 폴백 + ok 와 함께 경고 기록', async () => {
        process.env.EXTENSION_CATALOG_INDEX_ENABLED = 'true'; resetConfig();
        const d = indexDeps(async () => { throw new CatalogIndexFallbackError('INDEX_HASH_MISMATCH', '항목 해시 불일치 (x)'); });
        const out = await syncCatalogSource(d, row({ index_url: INDEX_URL }));
        expect(out.via).toBe('legacy');
        expect(d.service.fetchCatalogSnapshot).toHaveBeenCalledTimes(1);
        expect(d.repo.updateSnapshot).toHaveBeenCalledWith('c1', SNAPSHOT);
        const call = (d.repo.recordSyncResult.mock.calls as unknown[][])[0];
        expect(call.slice(0, 3)).toEqual(['c1', 'ok', null]);
        expect(String(call[3])).toContain('INDEX_HASH_MISMATCH');
    });

    it('모르는 형식 버전도 폴백 + 경고', async () => {
        process.env.EXTENSION_CATALOG_INDEX_ENABLED = 'true'; resetConfig();
        const d = indexDeps(async () => { throw new CatalogIndexFallbackError('INDEX_SCHEMA_UNSUPPORTED', 'v2'); });
        await syncCatalogSource(d, row({ index_url: INDEX_URL }));
        expect(d.service.fetchCatalogSnapshot).toHaveBeenCalledTimes(1);
        expect(String((d.repo.recordSyncResult.mock.calls as unknown[][])[0][3])).toContain('INDEX_SCHEMA_UNSUPPORTED');
    });

    it('원본 정책 거절은 폴백하지 않고 실패로 기록', async () => {
        process.env.EXTENSION_CATALOG_INDEX_ENABLED = 'true'; resetConfig();
        const d = indexDeps(async () => { throw new Error('EXTENSION_SOURCE_BLOCKED: 허용 목록 밖'); });
        await expect(syncCatalogSource(d, row({ index_url: INDEX_URL }))).rejects.toThrow('EXTENSION_SOURCE_BLOCKED');
        expect(d.service.fetchCatalogSnapshot).not.toHaveBeenCalled();
        expect((d.repo.recordSyncResult.mock.calls as unknown[][])[0][1]).toBe('error');
    });

    it('플래그 OFF(기본) 면 index_url 이 있어도 종전 방식', async () => {
        const d = indexDeps(async () => INDEX_SNAPSHOT);
        const out = await syncCatalogSource(d, row({ index_url: INDEX_URL }));
        expect(out.via).toBe('legacy');
        expect(d.service.fetchCatalogSnapshotFromIndex).not.toHaveBeenCalled();
        expect(d.repo.recordSyncResult).toHaveBeenCalledWith('c1', 'ok', null);
    });

    it('플래그 ON 이어도 index_url 이 없으면 종전 방식', async () => {
        process.env.EXTENSION_CATALOG_INDEX_ENABLED = 'true'; resetConfig();
        const d = indexDeps(async () => INDEX_SNAPSHOT);
        await syncCatalogSource(d, row({ index_url: null }));
        expect(d.service.fetchCatalogSnapshotFromIndex).not.toHaveBeenCalled();
        expect(d.service.fetchCatalogSnapshot).toHaveBeenCalledTimes(1);
    });
});
