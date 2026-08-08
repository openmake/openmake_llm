/**
 * naver-client — legacy ↔ NAVER API HUB 듀얼 경로 + 일일 한도 가드 단위 테스트.
 * env 파생 상수는 getConfig mock 으로 고정 (project_jest_env_dependent_tests 관용구).
 */
import { buildNaverSearchRequest } from '../naver-client';
import { getConfig } from '../../../config';
import { getKeyValueStore } from '../../../storage';

jest.mock('../../../config', () => ({
    ...jest.requireActual('../../../config'),
    getConfig: jest.fn(),
}));
jest.mock('../../../storage', () => ({
    getKeyValueStore: jest.fn(),
}));

const mockGetConfig = getConfig as jest.Mock;
const mockGetStore = getKeyValueStore as jest.Mock;

function setConfig(partial: Record<string, unknown>) {
    mockGetConfig.mockReturnValue({
        naverClientId: '',
        naverClientSecret: '',
        naverApiHubKeyId: '',
        naverApiHubKey: '',
        naverApiDailyLimit: 25000,
        ...partial,
    });
}

function setStoreCount(used: number) {
    mockGetStore.mockReturnValue({
        incrBy: jest.fn().mockResolvedValue(used),
        expire: jest.fn().mockResolvedValue(true),
    });
}

beforeEach(() => {
    jest.clearAllMocks();
    setStoreCount(1);
});

describe('buildNaverSearchRequest — 듀얼 경로', () => {
    it('HUB 키 설정 시 HUB URL + NCP 헤더', async () => {
        setConfig({ naverApiHubKeyId: 'hub-id', naverApiHubKey: 'hub-secret' });
        const req = await buildNaverSearchRequest('news', 'query=ai&display=5&sort=date');
        expect(req).not.toBeNull();
        expect(req!.route).toBe('hub');
        expect(req!.url).toBe('https://naverapihub.apigw.ntruss.com/search/v1/news?query=ai&display=5&sort=date');
        expect(req!.headers).toEqual({
            'X-NCP-APIGW-API-KEY-ID': 'hub-id',
            'X-NCP-APIGW-API-KEY': 'hub-secret',
        });
    });

    it('HUB 키 미설정 + legacy 키 설정 시 legacy URL(.json) + X-Naver 헤더', async () => {
        setConfig({ naverClientId: 'legacy-id', naverClientSecret: 'legacy-secret' });
        const req = await buildNaverSearchRequest('webkr', 'query=ai&display=10');
        expect(req).not.toBeNull();
        expect(req!.route).toBe('legacy');
        expect(req!.url).toBe('https://openapi.naver.com/v1/search/webkr.json?query=ai&display=10');
        expect(req!.headers).toEqual({
            'X-Naver-Client-Id': 'legacy-id',
            'X-Naver-Client-Secret': 'legacy-secret',
        });
    });

    it('HUB 키가 있으면 legacy 키가 있어도 HUB 우선', async () => {
        setConfig({
            naverClientId: 'legacy-id', naverClientSecret: 'legacy-secret',
            naverApiHubKeyId: 'hub-id', naverApiHubKey: 'hub-secret',
        });
        const req = await buildNaverSearchRequest('news', 'query=x');
        expect(req!.route).toBe('hub');
    });

    it('키 전부 미설정이면 null (graceful)', async () => {
        setConfig({});
        expect(await buildNaverSearchRequest('news', 'query=x')).toBeNull();
    });
});

describe('buildNaverSearchRequest — 일일 한도 가드', () => {
    it('한도 이내면 요청 반환 + 카운터 증가', async () => {
        setConfig({ naverClientId: 'id', naverClientSecret: 'sec', naverApiDailyLimit: 100 });
        setStoreCount(100); // 증가 후 100 == limit → 허용 (used > limit 만 차단)
        const req = await buildNaverSearchRequest('news', 'query=x');
        expect(req).not.toBeNull();
        expect(mockGetStore().incrBy).toHaveBeenCalled();
    });

    it('한도 초과면 null (요청 차단)', async () => {
        setConfig({ naverClientId: 'id', naverClientSecret: 'sec', naverApiDailyLimit: 100 });
        setStoreCount(101);
        expect(await buildNaverSearchRequest('news', 'query=x')).toBeNull();
    });

    it('한도 0 = 무제한 (카운터 미사용)', async () => {
        setConfig({ naverClientId: 'id', naverClientSecret: 'sec', naverApiDailyLimit: 0 });
        const store = { incrBy: jest.fn(), expire: jest.fn() };
        mockGetStore.mockReturnValue(store);
        const req = await buildNaverSearchRequest('news', 'query=x');
        expect(req).not.toBeNull();
        expect(store.incrBy).not.toHaveBeenCalled();
    });

    it('KVStore 장애 시 fail-open (요청 허용)', async () => {
        setConfig({ naverClientId: 'id', naverClientSecret: 'sec', naverApiDailyLimit: 100 });
        mockGetStore.mockImplementation(() => { throw new Error('redis down'); });
        expect(await buildNaverSearchRequest('news', 'query=x')).not.toBeNull();
    });

    it('일일 버킷 키는 KST 자정 경계로 바뀐다', async () => {
        setConfig({ naverClientId: 'id', naverClientSecret: 'sec', naverApiDailyLimit: 100 });
        const incrBy = jest.fn().mockResolvedValue(1);
        mockGetStore.mockReturnValue({ incrBy, expire: jest.fn().mockResolvedValue(true) });
        // 2026-08-07T14:59:59Z = KST 2026-08-07 23:59:59 / 15:00:00Z = KST 8/8 00:00:00
        await buildNaverSearchRequest('news', 'query=x', Date.parse('2026-08-07T14:59:59Z'));
        await buildNaverSearchRequest('news', 'query=x', Date.parse('2026-08-07T15:00:00Z'));
        const keys = incrBy.mock.calls.map((c) => c[0]);
        expect(keys[0]).not.toBe(keys[1]);
    });
});
