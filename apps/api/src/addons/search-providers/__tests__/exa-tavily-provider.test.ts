/**
 * searchExa / searchTavily — Tier1 escalation·Deep Research 전용 provider 단위 테스트.
 * 설정은 add-on 의 searchProviderSettings mock(daum-provider 관용구), fetch 는 global mock.
 */
import { searchExa, searchTavily } from '../external-search-apis';
import { searchProviderSettings } from '../settings';

jest.mock('../settings', () => ({ searchProviderSettings: jest.fn() }));

const mockGetConfig = searchProviderSettings as jest.Mock;
const mockFetch = jest.fn();

beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = mockFetch as unknown as typeof fetch;
});

describe('searchExa', () => {
    it('키 미설정이면 빈 배열 + fetch 미호출 (graceful)', async () => {
        mockGetConfig.mockReturnValue({ ...{ naverClientId: '', naverClientSecret: '', naverApiHubKeyId: '', naverApiHubKey: '', naverApiDailyLimit: 25000, naverSupplementaryRatio: 0.9, kakaoRestApiKey: '', exaApiKey: '', tavilyApiKey: '' }, exaApiKey: '' });
        expect(await searchExa('q', 10)).toEqual([]);
        expect(mockFetch).not.toHaveBeenCalled();
    });

    it('정상 응답 — x-api-key 헤더, POST body, publishedDate→date 매핑', async () => {
        mockGetConfig.mockReturnValue({ ...{ naverClientId: '', naverClientSecret: '', naverApiHubKeyId: '', naverApiHubKey: '', naverApiDailyLimit: 25000, naverSupplementaryRatio: 0.9, kakaoRestApiKey: '', exaApiKey: '', tavilyApiKey: '' }, exaApiKey: 'exa-key' });
        mockFetch.mockResolvedValue({
            ok: true,
            json: async () => ({
                results: [
                    { title: 'Manus', url: 'https://manus.im/', publishedDate: '2026-01-01' },
                    { title: '무URL' },
                ],
            }),
        });

        const results = await searchExa('manus ai', 10);

        const [url, init] = mockFetch.mock.calls[0];
        expect(url).toBe('https://api.exa.ai/search');
        expect(init.method).toBe('POST');
        expect(init.headers['x-api-key']).toBe('exa-key');
        expect(JSON.parse(init.body)).toEqual({ query: 'manus ai', numResults: 10, type: 'auto' });

        expect(results).toEqual([
            { title: 'Manus', url: 'https://manus.im/', snippet: '', source: 'exa.ai', date: '2026-01-01' },
        ]);
    });

    it('API 오류(402 크레딧 소진)면 빈 배열 graceful', async () => {
        mockGetConfig.mockReturnValue({ ...{ naverClientId: '', naverClientSecret: '', naverApiHubKeyId: '', naverApiHubKey: '', naverApiDailyLimit: 25000, naverSupplementaryRatio: 0.9, kakaoRestApiKey: '', exaApiKey: '', tavilyApiKey: '' }, exaApiKey: 'exa-key' });
        mockFetch.mockResolvedValue({ ok: false, status: 402 });
        expect(await searchExa('q', 10)).toEqual([]);
    });
});

describe('searchTavily', () => {
    it('키 미설정이면 빈 배열 + fetch 미호출 (graceful)', async () => {
        mockGetConfig.mockReturnValue({ ...{ naverClientId: '', naverClientSecret: '', naverApiHubKeyId: '', naverApiHubKey: '', naverApiDailyLimit: 25000, naverSupplementaryRatio: 0.9, kakaoRestApiKey: '', exaApiKey: '', tavilyApiKey: '' }, tavilyApiKey: '' });
        expect(await searchTavily('q', 5)).toEqual([]);
        expect(mockFetch).not.toHaveBeenCalled();
    });

    it('정상 응답 — Bearer 헤더, search_depth 전달, content→snippet 매핑', async () => {
        mockGetConfig.mockReturnValue({ ...{ naverClientId: '', naverClientSecret: '', naverApiHubKeyId: '', naverApiHubKey: '', naverApiDailyLimit: 25000, naverSupplementaryRatio: 0.9, kakaoRestApiKey: '', exaApiKey: '', tavilyApiKey: '' }, tavilyApiKey: 'tvly-key' });
        mockFetch.mockResolvedValue({
            ok: true,
            json: async () => ({
                results: [
                    { title: '문서', url: 'https://a.example/1', content: '정제 본문', published_date: '2026-02-02' },
                ],
            }),
        });

        const results = await searchTavily('질의', 5, 'advanced');

        const [url, init] = mockFetch.mock.calls[0];
        expect(url).toBe('https://api.tavily.com/search');
        expect(init.headers.Authorization).toBe('Bearer tvly-key');
        expect(JSON.parse(init.body)).toEqual({ query: '질의', max_results: 5, search_depth: 'advanced' });

        expect(results).toEqual([
            { title: '문서', url: 'https://a.example/1', snippet: '정제 본문', source: 'tavily.com', date: '2026-02-02' },
        ]);
    });

    it('API 오류면 빈 배열 graceful', async () => {
        mockGetConfig.mockReturnValue({ ...{ naverClientId: '', naverClientSecret: '', naverApiHubKeyId: '', naverApiHubKey: '', naverApiDailyLimit: 25000, naverSupplementaryRatio: 0.9, kakaoRestApiKey: '', exaApiKey: '', tavilyApiKey: '' }, tavilyApiKey: 'tvly-key' });
        mockFetch.mockResolvedValue({ ok: false, status: 401 });
        expect(await searchTavily('q', 5)).toEqual([]);
    });
});
