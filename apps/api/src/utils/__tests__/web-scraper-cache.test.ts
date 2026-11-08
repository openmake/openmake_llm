/**
 * G1(스크랩 캐시)·G4(URL 정규화) 단위 테스트 (2026-08-08)
 *
 * - normalizeScrapeUrl: fragment/트래킹 파라미터 제거·호스트 소문자화·비URL 원문 보존
 * - scrapePage 캐시: 히트 시 실스크랩 생략, 미스 시 스크랩 후 TTL 저장, 캐시 오류 fail-open
 *
 * 실네트워크 차단: ssrf-guard·web-scraper-handlers 를 mock, 1단계 fetch 는 구조화 소스
 * mock 결과로 단락시킨다 (환각 불가 — 저장/조회는 실제 MemoryStore 사용).
 */
import { normalizeScrapeUrl, scrapePage } from '../web-scraper';
import { acquirePlaywrightSlot, renderPageHtml } from '../web-scraper-playwright';
import { MemoryStore } from '../../storage/memory-store';

// 실 Redis 격리: 운영 .env 가 STORAGE_BACKEND=redis 면 getKeyValueStore 가 실 Redis 에
// 붙는다 — 테스트는 파일 로컬 MemoryStore 로 고정 (project_jest_env_dependent_tests 관용구).
let mockStore: MemoryStore;
jest.mock('../../storage', () => ({
    ...jest.requireActual('../../storage'),
    getKeyValueStore: () => mockStore,
}));

jest.mock('../../security/ssrf-guard', () => ({
    safeFetch: jest.fn(),
    validateOutboundUrl: jest.fn().mockResolvedValue(undefined),
    resolveOutboundUrl: jest.fn(async (u: string) => ({ url: new URL(u), address: mockResolvedAddress })),
    isBlockedIP: jest.fn().mockReturnValue(false),
}));

const structuredMock = jest.fn();
jest.mock('../web-scraper-handlers', () => ({
    resolveStructuredSource: (...args: unknown[]) => structuredMock(...args),
    resolveBlockedSource: jest.fn().mockResolvedValue(null),
    tryRssFallback: jest.fn().mockResolvedValue(null),
}));

// 2단계 Playwright fallback 이 실제 브라우저를 띄우지 않도록 차단 (동적 import 대상 mock).
// 기본은 기동 실패 — 폴백 경로를 보는 테스트만 가짜 브라우저를 한 번씩 돌려준다.
let mockResolvedAddress = '93.184.216.34';
const mockLaunch = jest.fn().mockRejectedValue(new Error('playwright disabled in test'));
jest.mock('playwright-core', () => ({
    chromium: { launch: (...args: unknown[]) => mockLaunch(...args) },
}), { virtual: true });

describe('normalizeScrapeUrl (G4)', () => {
    it('fragment 를 제거한다', () => {
        expect(normalizeScrapeUrl('https://example.com/page#section-2')).toBe('https://example.com/page');
    });

    it('utm_* prefix 트래킹 파라미터를 제거하고 일반 파라미터는 보존한다', () => {
        expect(normalizeScrapeUrl('https://example.com/a?utm_source=x&utm_medium=y&q=hello'))
            .toBe('https://example.com/a?q=hello');
    });

    it('정확 일치 트래킹 파라미터(gclid/fbclid)를 제거한다', () => {
        expect(normalizeScrapeUrl('https://example.com/?gclid=abc&fbclid=def&page=2'))
            .toBe('https://example.com/?page=2');
    });

    it('호스트를 소문자화한다', () => {
        expect(normalizeScrapeUrl('https://EXAMPLE.com/Path')).toBe('https://example.com/Path');
    });

    it('URL 파싱 불가 입력은 원문을 반환한다', () => {
        expect(normalizeScrapeUrl('not a url')).toBe('not a url');
    });
});

describe('scrapePage 캐시 (G1)', () => {
    beforeEach(() => {
        mockStore = new MemoryStore();
        structuredMock.mockReset();
        structuredMock.mockResolvedValue({ markdown: '# 본문', title: '제목', links: [] });
    });

    it('첫 호출은 실스크랩, 두 번째 호출은 캐시 히트로 실스크랩을 생략한다', async () => {
        const r1 = await scrapePage('https://example.com/doc?utm_source=x');
        expect(r1.markdown).toBe('# 본문');
        expect(structuredMock).toHaveBeenCalledTimes(1);

        // 트래킹 파라미터만 다른 변형 URL → 정규화로 같은 캐시 키
        const r2 = await scrapePage('https://example.com/doc?utm_source=y#frag');
        expect(r2.markdown).toBe('# 본문');
        expect(structuredMock).toHaveBeenCalledTimes(1); // 실스크랩 재호출 없음
    });

    it('빈 결과는 캐시하지 않는다 (다음 호출이 재시도)', async () => {
        structuredMock.mockResolvedValueOnce({ markdown: '', title: '', links: [] });
        structuredMock.mockResolvedValueOnce({ markdown: '# 재시도 성공', title: 't', links: [] });
        // 빈 markdown → 1단계로 진행하나 safeFetch mock 이 undefined 반환 → 전 단계 실패로 throw
        await expect(scrapePage('https://empty.example.com/')).rejects.toThrow();
        const r = await scrapePage('https://empty.example.com/');
        expect(r.markdown).toBe('# 재시도 성공');
    });

    it('캐시 계층 오류는 fail-open (스크랩 결과 정상 반환)', async () => {
        jest.spyOn(mockStore, 'get').mockRejectedValueOnce(new Error('redis down'));
        const r = await scrapePage('https://failopen.example.com/');
        expect(r.markdown).toBe('# 본문');
    });
});

describe('Playwright 폴백 브라우저 설정 (2026-11-08 점검 후속 보강)', () => {
    const HTML = '<html><body><p>렌더링한 본문</p></body></html>';

    function fakeBrowser(pageUrl: string, goto: () => Promise<unknown> = async () => undefined) {
        const page = {
            route: jest.fn().mockResolvedValue(undefined),
            routeWebSocket: jest.fn().mockResolvedValue(undefined),
            goto: jest.fn(goto),
            url: jest.fn().mockReturnValue(pageUrl),
            content: jest.fn().mockResolvedValue(HTML),
        };
        const context = { newPage: jest.fn().mockResolvedValue(page), close: jest.fn().mockResolvedValue(undefined) };
        const browser = {
            newContext: jest.fn().mockResolvedValue(context),
            newPage: jest.fn().mockResolvedValue(page),
            close: jest.fn().mockResolvedValue(undefined),
        };
        return { browser, context, page };
    }

    beforeEach(() => {
        mockLaunch.mockClear();
        mockResolvedAddress = '93.184.216.34';
    });

    it('대상 호스트를 검증한 주소에 고정하고 서비스 워커·WebSocket 을 막는다', async () => {
        const { browser, page } = fakeBrowser('https://spa.example.com/');
        mockLaunch.mockResolvedValueOnce(browser);

        expect(await renderPageHtml('https://spa.example.com/', 1000)).toBe(HTML);

        const launchOpts = mockLaunch.mock.calls[0][0] as { args?: string[] };
        expect(launchOpts.args).toContain('--host-resolver-rules=MAP spa.example.com 93.184.216.34');
        expect(browser.newContext).toHaveBeenCalledWith(expect.objectContaining({ serviceWorkers: 'block' }));
        expect(browser.newPage).not.toHaveBeenCalled();
        expect(page.routeWebSocket).toHaveBeenCalledWith('**', expect.any(Function));
        const handler = page.routeWebSocket.mock.calls[0][1] as (ws: { close: () => unknown }) => unknown;
        const ws = { close: jest.fn() };
        await handler(ws);
        expect(ws.close).toHaveBeenCalled();
        expect(browser.close).toHaveBeenCalled();
    });

    it('IPv6 주소는 대괄호로 감싸 고정한다', async () => {
        mockResolvedAddress = '2606:2800:220:1::1';
        const { browser } = fakeBrowser('https://v6.example.com/');
        mockLaunch.mockResolvedValueOnce(browser);

        await renderPageHtml('https://v6.example.com/', 1000);
        const launchOpts = mockLaunch.mock.calls[0][0] as { args?: string[] };
        expect(launchOpts.args).toContain('--host-resolver-rules=MAP v6.example.com [2606:2800:220:1::1]');
    });

    it('동시 실행 상한(기본 2)을 넘으면 브라우저를 띄우지 않고 던지고, 끝나면 자리를 돌려준다', async () => {
        let release: () => void = () => undefined;
        const pending = new Promise<void>((resolve) => { release = resolve; });
        mockLaunch.mockResolvedValueOnce(fakeBrowser('https://a.example.com/', () => pending).browser);
        mockLaunch.mockResolvedValueOnce(fakeBrowser('https://b.example.com/', () => pending).browser);

        const first = renderPageHtml('https://a.example.com/', 1000);
        const second = renderPageHtml('https://b.example.com/', 1000);
        await expect(renderPageHtml('https://c.example.com/', 1000)).rejects.toThrow('동시 실행 상한');

        release();
        await Promise.all([first, second]);
        expect(mockLaunch).toHaveBeenCalledTimes(2); // 상한에 걸린 호출은 브라우저를 띄우지 않았다
        mockLaunch.mockResolvedValueOnce(fakeBrowser('https://c.example.com/').browser);
        expect(await renderPageHtml('https://c.example.com/', 1000)).toBe(HTML);
        expect(mockLaunch).toHaveBeenCalledTimes(3);
    });

    it('브라우저 기동이 실패해도 자리를 돌려준다', async () => {
        mockLaunch.mockRejectedValueOnce(new Error('launch failed'));
        mockLaunch.mockRejectedValueOnce(new Error('launch failed'));
        await expect(renderPageHtml('https://x.example.com/', 1000)).rejects.toThrow('launch failed');
        await expect(renderPageHtml('https://y.example.com/', 1000)).rejects.toThrow('launch failed');
        mockLaunch.mockResolvedValueOnce(fakeBrowser('https://z.example.com/').browser);
        expect(await renderPageHtml('https://z.example.com/', 1000)).toBe(HTML);
    });
});

describe('acquirePlaywrightSlot — 브라우저 동시 실행 상한', () => {
    it('상한까지만 자리를 내주고 넘으면 false', () => {
        const state = { inFlight: 0 };
        expect(acquirePlaywrightSlot(state, 2)).toBe(true);
        expect(acquirePlaywrightSlot(state, 2)).toBe(true);
        expect(acquirePlaywrightSlot(state, 2)).toBe(false);
        expect(state.inFlight).toBe(2);
    });

    it('자리를 돌려받으면 다시 내준다', () => {
        const state = { inFlight: 2 };
        expect(acquirePlaywrightSlot(state, 2)).toBe(false);
        state.inFlight -= 1;
        expect(acquirePlaywrightSlot(state, 2)).toBe(true);
    });
});
