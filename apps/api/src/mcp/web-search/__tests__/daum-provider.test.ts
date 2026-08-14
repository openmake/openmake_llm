/**
 * searchDaumWeb — 카카오(Daum) 웹문서 검색 provider 단위 테스트.
 * getConfig 는 mock 으로 고정(project_jest_env_dependent_tests 관용구), fetch 는 global mock.
 */
import { searchDaumWeb } from '../providers';
import { getConfig } from '../../../config/env';

// getConfig 를 통째로 비우면 모듈 로드 시점의 logger(getConfig().logLevel)가 죽으므로
// 기본 구현은 실제 getConfig 로 위임하고, 각 테스트에서 mockReturnValue 로 덮는다.
jest.mock('../../../config/env', () => {
    const actual = jest.requireActual('../../../config/env');
    return { ...actual, getConfig: jest.fn(actual.getConfig) };
});

const mockGetConfig = getConfig as jest.Mock;
const mockFetch = jest.fn();

function setKey(key: string) {
    mockGetConfig.mockReturnValue({ kakaoRestApiKey: key });
}

beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = mockFetch as unknown as typeof fetch;
});

describe('searchDaumWeb', () => {
    it('키 미설정이면 빈 배열 + fetch 미호출 (graceful)', async () => {
        setKey('');
        expect(await searchDaumWeb('테스트')).toEqual([]);
        expect(mockFetch).not.toHaveBeenCalled();
    });

    it('정상 응답 — KakaoAK 헤더, <b> 태그 제거, datetime→date 매핑', async () => {
        setKey('rest-key');
        mockFetch.mockResolvedValue({
            ok: true,
            json: async () => ({
                documents: [
                    { title: '<b>인공지능</b> 개요', url: 'https://a.example/1', contents: '요약 <b>내용</b>', datetime: '2026-08-01T00:00:00.000+09:00' },
                    { title: '무URL 문서', contents: 'url 없음' },
                ],
            }),
        });

        const results = await searchDaumWeb('인공지능', 5);

        expect(mockFetch).toHaveBeenCalledTimes(1);
        const [url, init] = mockFetch.mock.calls[0];
        expect(url).toBe('https://dapi.kakao.com/v2/search/web?query=%EC%9D%B8%EA%B3%B5%EC%A7%80%EB%8A%A5&size=5');
        expect(init.headers).toEqual({ Authorization: 'KakaoAK rest-key' });

        expect(results).toEqual([
            {
                title: '인공지능 개요',
                url: 'https://a.example/1',
                snippet: '요약 내용',
                source: 'daum.net',
                date: '2026-08-01T00:00:00.000+09:00',
            },
        ]);
    });

    it('API 오류(429 쿼터 초과)면 빈 배열 graceful', async () => {
        setKey('rest-key');
        mockFetch.mockResolvedValue({ ok: false, status: 429 });
        expect(await searchDaumWeb('테스트')).toEqual([]);
    });

    it('size 는 API 상한 50 으로 클램프', async () => {
        setKey('rest-key');
        mockFetch.mockResolvedValue({ ok: true, json: async () => ({ documents: [] }) });
        await searchDaumWeb('q', 100);
        expect(mockFetch.mock.calls[0][0]).toContain('&size=50');
    });
});
