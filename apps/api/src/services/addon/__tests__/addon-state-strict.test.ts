/**
 * strict 켜짐 판정 — '조회 실패'를 '켜짐'으로 읽지 않는다(라우트 게이트·채팅 훅 게이트가 쓴다).
 * env 차단은 DB 없이 안다. 캐시(TTL 안)는 쓰고, 만료·미적재면 다시 읽고, 읽기에 실패하면 known:false.
 */
const listRows = jest.fn();
jest.mock('../../../data/repositories/addon-state-repository', () => ({
    AddonStateRepository: jest.fn().mockImplementation(() => ({ list: listRows })),
}));
jest.mock('../../../data/models/unified-database', () => ({ getUnifiedDatabase: () => ({ getPool: () => ({}) }) }));

import { readAddonEnabledStrict, clearAddonStateCache, ensureAddonStates, isAddonEnabledSync, __resetAddonStateCacheForTest } from '../addon-state';
import { ADDON_STATE_CACHE_TTL_MS } from '../../../config/runtime-limits';

const ENV_KEY = 'ADDON_BUILTIN_DISABLED';

beforeEach(() => {
    jest.clearAllMocks();
    __resetAddonStateCacheForTest();
    delete process.env[ENV_KEY];
    listRows.mockResolvedValue([
        { addon_id: 'industry-pack', state: 'enabled' },
        { addon_id: 'sleeping-pack', state: 'disabled' },
        { addon_id: 'broken-pack', state: 'failed' },
        { addon_id: 'fresh-pack', state: 'installed' },
    ]);
});

afterEach(() => {
    jest.restoreAllMocks();
});

/** 첫 적재 시각을 고정하고, 이후 시계를 TTL 너머로 옮긴다 */
function moveClockPastTtl(base: number): void {
    jest.spyOn(Date, 'now').mockReturnValue(base + ADDON_STATE_CACHE_TTL_MS + 1);
}

describe('readAddonEnabledStrict', () => {
    it('env 로 끈 add-on 은 DB 를 묻지 않고 enabled:false', async () => {
        process.env[ENV_KEY] = 'industry-pack';
        expect(await readAddonEnabledStrict('industry-pack')).toEqual({ known: true, enabled: false, state: 'env_disabled' });
        expect(listRows).not.toHaveBeenCalled();
    });

    it('DB 의도 enabled → enabled:true, disabled → enabled:false', async () => {
        expect(await readAddonEnabledStrict('industry-pack')).toEqual({ known: true, enabled: true, state: 'enabled' });
        expect(await readAddonEnabledStrict('sleeping-pack')).toEqual({ known: true, enabled: false, state: 'disabled' });
    });

    it('부팅 실패(failed)·설치만 됨(installed) 은 enabled:false 이고 state 로 구분한다', async () => {
        expect(await readAddonEnabledStrict('broken-pack')).toEqual({ known: true, enabled: false, state: 'failed' });
        expect(await readAddonEnabledStrict('fresh-pack')).toEqual({ known: true, enabled: false, state: 'installed' });
    });

    it('행이 없는(미등록) add-on 은 기본 의도 enabled', async () => {
        expect(await readAddonEnabledStrict('unknown-pack')).toEqual({ known: true, enabled: true, state: 'enabled' });
    });

    it('캐시가 없고 적재가 실패하면 known:false (켜짐으로 읽지 않는다)', async () => {
        listRows.mockRejectedValue(new Error('DB 장애'));
        const v = await readAddonEnabledStrict('industry-pack');
        expect(v.known).toBe(false);
        if (!v.known) expect(v.reason).toContain('DB 장애');
    });

    it('TTL 안의 캐시는 DB 를 다시 묻지 않는다', async () => {
        await readAddonEnabledStrict('industry-pack');
        listRows.mockRejectedValue(new Error('DB 장애'));
        expect(await readAddonEnabledStrict('sleeping-pack')).toEqual({ known: true, enabled: false, state: 'disabled' });
        expect(listRows).toHaveBeenCalledTimes(1);
    });

    it('동시 호출은 적재 1회로 합친다', async () => {
        await Promise.all([readAddonEnabledStrict('industry-pack'), readAddonEnabledStrict('sleeping-pack'), readAddonEnabledStrict('x')]);
        expect(listRows).toHaveBeenCalledTimes(1);
    });

    it('fail-open 경로(ensureAddonStates)와 inflight 를 공유해도 그쪽은 던지지 않는다', async () => {
        listRows.mockRejectedValue(new Error('DB 장애'));
        const [strict] = await Promise.all([readAddonEnabledStrict('industry-pack'), ensureAddonStates()]);
        expect(strict.known).toBe(false);
        expect(listRows).toHaveBeenCalledTimes(1);
    });

    it('만료된 캐시는 다시 읽는다', async () => {
        const base = 1_000_000;
        jest.spyOn(Date, 'now').mockReturnValue(base);
        expect(await readAddonEnabledStrict('industry-pack')).toEqual({ known: true, enabled: true, state: 'enabled' });
        expect(listRows).toHaveBeenCalledTimes(1);
        moveClockPastTtl(base);
        listRows.mockResolvedValue([{ addon_id: 'industry-pack', state: 'disabled' }]);
        expect(await readAddonEnabledStrict('industry-pack')).toEqual({ known: true, enabled: false, state: 'disabled' });
        expect(listRows).toHaveBeenCalledTimes(2);
    });

    it('만료된 캐시 + 재적재 실패 → known:false (옛 값으로 답하지 않는다)', async () => {
        const base = 1_000_000;
        jest.spyOn(Date, 'now').mockReturnValue(base);
        expect(await readAddonEnabledStrict('industry-pack')).toEqual({ known: true, enabled: true, state: 'enabled' });
        moveClockPastTtl(base);
        listRows.mockRejectedValue(new Error('DB 장애'));
        const v = await readAddonEnabledStrict('industry-pack');
        expect(v.known).toBe(false);
        expect(listRows).toHaveBeenCalledTimes(2);
    });
});

describe('clearAddonStateCache 와 동기 판정', () => {
    it('비운 뒤에도 동기 판정은 마지막으로 알던 값을 쓴다(꺼둔 add-on 이 켜짐으로 되살아나지 않는다)', async () => {
        await ensureAddonStates();
        expect(isAddonEnabledSync('sleeping-pack')).toBe(false);
        clearAddonStateCache();
        expect(isAddonEnabledSync('sleeping-pack')).toBe(false);
        expect(isAddonEnabledSync('industry-pack')).toBe(true);
    });

    it('비운 뒤 다음 조회는 DB 를 다시 읽는다', async () => {
        await ensureAddonStates();
        expect(listRows).toHaveBeenCalledTimes(1);
        clearAddonStateCache();
        listRows.mockResolvedValueOnce([{ addon_id: 'sleeping-pack', state: 'enabled' }]);
        expect(await readAddonEnabledStrict('sleeping-pack')).toEqual({ known: true, enabled: true, state: 'enabled' });
        expect(listRows).toHaveBeenCalledTimes(2);
        expect(isAddonEnabledSync('sleeping-pack')).toBe(true);
    });

    it('첫 적재 전(캐시 없음)에는 env 판정만으로 켜짐(fail-open)', () => {
        expect(isAddonEnabledSync('sleeping-pack')).toBe(true);
    });

    it('적재 도중 비워지면 그 스냅숏(쓰기 전 값)을 버리고 다시 읽는다', async () => {
        let resolveFirst!: (rows: unknown[]) => void;
        listRows.mockReset();
        listRows.mockImplementationOnce(() => new Promise((r) => { resolveFirst = r; }));
        listRows.mockResolvedValueOnce([{ addon_id: 'industry-pack', state: 'disabled' }]);
        const pending = ensureAddonStates();
        while (listRows.mock.calls.length === 0) await new Promise((r) => setImmediate(r)); // 쿼리가 시작된 뒤
        clearAddonStateCache(); // 관리자가 industry-pack 을 껐다 — 진행 중인 적재는 쓰기 전 스냅숏
        resolveFirst([{ addon_id: 'industry-pack', state: 'enabled' }]);
        await pending;
        expect(listRows).toHaveBeenCalledTimes(2);
        expect(isAddonEnabledSync('industry-pack')).toBe(false);
        expect(await readAddonEnabledStrict('industry-pack')).toEqual({ known: true, enabled: false, state: 'disabled' });
    });
});
