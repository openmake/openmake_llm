/**
 * strict 켜짐 판정 — '조회 실패'를 '켜짐'으로 읽지 않는다(라우트 게이트·채팅 훅 게이트가 쓴다).
 * env 차단은 DB 없이 안다. 캐시(TTL 안)는 쓰고, 만료·미적재면 다시 읽고, 읽기에 실패하면 known:false.
 */
const listRows = jest.fn();
jest.mock('../../../data/repositories/addon-state-repository', () => ({
    AddonStateRepository: jest.fn().mockImplementation(() => ({ list: listRows })),
}));
jest.mock('../../../data/models/unified-database', () => ({ getUnifiedDatabase: () => ({ getPool: () => ({}) }) }));

import { readAddonEnabledStrict, clearAddonStateCache, ensureAddonStates } from '../addon-state';

const ENV_KEY = 'ADDON_BUILTIN_DISABLED';

beforeEach(() => {
    jest.clearAllMocks();
    clearAddonStateCache();
    delete process.env[ENV_KEY];
    listRows.mockResolvedValue([
        { addon_id: 'industry-pack', state: 'enabled' },
        { addon_id: 'sleeping-pack', state: 'disabled' },
    ]);
});

describe('readAddonEnabledStrict', () => {
    it('env 로 끈 add-on 은 DB 를 묻지 않고 enabled:false', async () => {
        process.env[ENV_KEY] = 'industry-pack';
        expect(await readAddonEnabledStrict('industry-pack')).toEqual({ known: true, enabled: false });
        expect(listRows).not.toHaveBeenCalled();
    });

    it('DB 의도 enabled → enabled:true, disabled → enabled:false', async () => {
        expect(await readAddonEnabledStrict('industry-pack')).toEqual({ known: true, enabled: true });
        expect(await readAddonEnabledStrict('sleeping-pack')).toEqual({ known: true, enabled: false });
    });

    it('행이 없는(미등록) add-on 은 기본 의도 enabled', async () => {
        expect(await readAddonEnabledStrict('unknown-pack')).toEqual({ known: true, enabled: true });
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
        expect(await readAddonEnabledStrict('sleeping-pack')).toEqual({ known: true, enabled: false });
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
    });
});
