/**
 * buildUrlContext 단위 테스트 — 채팅 메시지 URL 자동 분석 (2026-06-13)
 *
 * URL 추출/dedup/개수 캡, 본문 절단, 실패 시 추측 금지 안내,
 * URL 미포함 메시지의 무동작을 검증한다. scrapePage 는 mock.
 */
import { URL_ANALYZE_LIMITS } from '../config/runtime-limits';

const mockScrapePage = jest.fn();
jest.mock('../utils/web-scraper', () => ({
    scrapePage: (...args: unknown[]) => mockScrapePage(...args),
}));

import { buildUrlContext } from '../services/chat-service/attach-context';

describe('buildUrlContext', () => {
    beforeEach(() => {
        mockScrapePage.mockReset();
        mockScrapePage.mockResolvedValue({ markdown: '본문 내용', title: '테스트 페이지', links: [] });
    });

    it('URL 이 없는 메시지는 빈 문자열을 반환하고 스크랩하지 않는다', async () => {
        expect(await buildUrlContext('그냥 일반 질문입니다')).toBe('');
        expect(await buildUrlContext('')).toBe('');
        expect(mockScrapePage).not.toHaveBeenCalled();
    });

    it('URL 본문을 제목과 함께 링크 분석 블록으로 주입한다', async () => {
        const ctx = await buildUrlContext('이 글 요약해줘 https://example.com/post');
        expect(ctx).toContain('## 🔗 링크 분석');
        expect(ctx).toContain('### https://example.com/post');
        expect(ctx).toContain('제목: 테스트 페이지');
        expect(ctx).toContain('본문 내용');
    });

    it('중복 URL 은 1회만, 끝 문장부호는 제거하고 스크랩한다', async () => {
        await buildUrlContext(
            '봐줘 https://example.com/a. 그리고 https://example.com/a 다시',
        );
        expect(mockScrapePage).toHaveBeenCalledTimes(1);
        expect(mockScrapePage.mock.calls[0][0]).toBe('https://example.com/a');
    });

    it('균형 잡힌 괄호를 포함한 URL 은 절단하지 않는다 (위키피디아류)', async () => {
        await buildUrlContext('이거 봐줘 https://en.wikipedia.org/wiki/Seoul_(city)');
        expect(mockScrapePage.mock.calls[0][0]).toBe('https://en.wikipedia.org/wiki/Seoul_(city)');
    });

    it('마크다운 링크의 닫는 괄호는 URL 에서 제거한다', async () => {
        await buildUrlContext('[설명](https://example.com/page) 분석해줘');
        expect(mockScrapePage.mock.calls[0][0]).toBe('https://example.com/page');
    });

    it('scrapePage 에 stage별 타임아웃 절반과 AbortSignal 을 전달한다', async () => {
        await buildUrlContext('https://example.com/a');
        const opts = mockScrapePage.mock.calls[0][1] as { timeoutMs: number; signal: AbortSignal };
        expect(opts.timeoutMs).toBe(Math.floor(URL_ANALYZE_LIMITS.TIMEOUT_MS / 2));
        expect(opts.signal).toBeInstanceOf(AbortSignal);
    });

    it('MAX_URLS 초과분은 스크랩하지 않는다', async () => {
        const urls = Array.from({ length: URL_ANALYZE_LIMITS.MAX_URLS + 2 },
            (_, i) => `https://example.com/p${i}`).join(' ');
        await buildUrlContext(urls);
        expect(mockScrapePage).toHaveBeenCalledTimes(URL_ANALYZE_LIMITS.MAX_URLS);
    });

    it('본문이 캡을 초과하면 절단하고 안내를 붙인다', async () => {
        mockScrapePage.mockResolvedValue({
            markdown: 'z'.repeat(URL_ANALYZE_LIMITS.MAX_CHARS_PER_URL + 5000),
            title: '긴 글', links: [],
        });
        const ctx = await buildUrlContext('https://example.com/long');
        expect(ctx).toContain('자만 포함됨');
        expect(ctx.length).toBeLessThan(URL_ANALYZE_LIMITS.MAX_CHARS_PER_URL + 5000);
    });

    it('스크랩 실패 시 추측 금지 안내를 주입한다 (블록 자체는 생성)', async () => {
        mockScrapePage.mockRejectedValue(new Error('연결 실패'));
        const ctx = await buildUrlContext('https://dead.example.com 분석해줘');
        expect(ctx).toContain('### https://dead.example.com');
        expect(ctx).toContain('추측하지 말고');
    });

    it('일부 실패 + 일부 성공이 섞여도 각각 올바르게 기재한다', async () => {
        mockScrapePage
            .mockResolvedValueOnce({ markdown: '성공 본문', title: 'OK', links: [] })
            .mockRejectedValueOnce(new Error('404'));
        const ctx = await buildUrlContext('https://ok.example.com https://fail.example.com');
        expect(ctx).toContain('성공 본문');
        expect(ctx).toContain('### https://fail.example.com');
        expect(ctx).toContain('추측하지 말고');
    });
});
