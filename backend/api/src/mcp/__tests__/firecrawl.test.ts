/**
 * Firecrawl MCP Tools Unit Tests
 *
 * test-preload.ts에서 FIRECRAWL_API_KEY가 설정되므로 모듈 로드 시 API 키가 반영됩니다.
 * firecrawlPost를 mock하여 실제 HTTP 호출 없이 handler 로직을 테스트합니다.
 */

import { afterEach, describe, expect, it, mock } from 'bun:test';

// firecrawlPost mock — 실제 HTTP 호출 방지
const mockFirecrawlPost = mock(() => Promise.resolve({}));
mock.module('../../utils/firecrawl-client', () => ({
    firecrawlPost: mockFirecrawlPost,
}));

import {
    isFirecrawlConfigured,
    getFirecrawlStatus,
    firecrawlScrapeTool,
    firecrawlSearchTool,
    firecrawlMapTool,
    firecrawlCrawlTool,
    firecrawlTools,
} from '../firecrawl';

describe('firecrawl MCP tools', () => {
    afterEach(() => {
        mockFirecrawlPost.mockReset();
    });

    // ==============================
    // Utility Functions
    // ==============================

    it('isFirecrawlConfigured returns true when API key exists', () => {
        expect(isFirecrawlConfigured()).toBe(true);
    });

    it('getFirecrawlStatus returns configured status and apiUrl', () => {
        const status = getFirecrawlStatus();
        expect(status).toEqual({
            configured: true,
            apiUrl: 'https://api.firecrawl.dev/v1',
        });
    });

    it('firecrawlTools array has 4 tools', () => {
        expect(firecrawlTools.length).toBe(4);
        const names = firecrawlTools.map((t) => t.tool.name);
        expect(names).toContain('firecrawl_scrape');
        expect(names).toContain('firecrawl_search');
        expect(names).toContain('firecrawl_map');
        expect(names).toContain('firecrawl_crawl');
    });

    // ==============================
    // Tool Schema Validation
    // ==============================

    it('each tool has required inputSchema with url or query', () => {
        expect(firecrawlScrapeTool.tool.inputSchema.required).toContain('url');
        expect(firecrawlSearchTool.tool.inputSchema.required).toContain('query');
        expect(firecrawlMapTool.tool.inputSchema.required).toContain('url');
        expect(firecrawlCrawlTool.tool.inputSchema.required).toContain('url');
    });

    // ==============================
    // Handler Success Cases
    // ==============================

    it('firecrawlScrapeTool.handler returns markdown content on success', async () => {
        mockFirecrawlPost.mockResolvedValueOnce({
            data: { markdown: '# Sample Markdown' },
        });

        const result = await firecrawlScrapeTool.handler({
            url: 'https://example.com',
        });

        expect(result.isError).toBe(false);
        expect(result.content[0].type).toBe('text');
        expect(result.content[0].text).toContain('스크래핑 완료');
        expect(result.content[0].text).toContain('# Sample Markdown');
    });

    it('firecrawlScrapeTool.handler falls back to html content', async () => {
        mockFirecrawlPost.mockResolvedValueOnce({
            data: { html: '<h1>HTML Content</h1>' },
        });

        const result = await firecrawlScrapeTool.handler({
            url: 'https://example.com',
        });

        expect(result.isError).toBe(false);
        expect(result.content[0].text).toContain('<h1>HTML Content</h1>');
    });

    it('firecrawlScrapeTool.handler passes correct parameters', async () => {
        mockFirecrawlPost.mockResolvedValueOnce({ data: { markdown: 'ok' } });

        await firecrawlScrapeTool.handler({ url: 'https://example.com' });

        expect(mockFirecrawlPost).toHaveBeenCalledTimes(1);
        const callArgs = (mockFirecrawlPost.mock.calls as unknown as Array<[Record<string, unknown>]>)[0][0];
        const data = callArgs.data as Record<string, unknown>;
        expect(data.url).toBe('https://example.com');
        expect(data.formats).toEqual(['markdown']);
        expect(data.onlyMainContent).toBe(true);
    });

    it('firecrawlSearchTool.handler returns search results on success', async () => {
        mockFirecrawlPost.mockResolvedValueOnce({
            data: [
                {
                    title: 'First result',
                    url: 'https://example.com/1',
                    description: 'Description 1',
                },
                { title: 'Second result', url: 'https://example.com/2' },
            ],
        });

        const result = await firecrawlSearchTool.handler({
            query: 'test query',
        });

        expect(result.isError).toBe(false);
        expect(result.content[0].text).toContain('검색 결과 (2건)');
        expect(result.content[0].text).toContain('First result');
        expect(result.content[0].text).toContain('https://example.com/2');
    });

    it('firecrawlMapTool.handler returns mapped links on success', async () => {
        mockFirecrawlPost.mockResolvedValueOnce({
            links: ['https://example.com', 'https://example.com/docs'],
        });

        const result = await firecrawlMapTool.handler({
            url: 'https://example.com',
        });

        expect(result.isError).toBe(false);
        expect(result.content[0].text).toContain('URL 매핑 결과 (2개 발견)');
        expect(result.content[0].text).toContain('1. https://example.com');
        expect(result.content[0].text).toContain(
            '2. https://example.com/docs'
        );
    });

    it('firecrawlCrawlTool.handler returns crawl job id on success', async () => {
        mockFirecrawlPost.mockResolvedValueOnce({
            jobId: 'job_123',
            status: 'queued',
        });

        const result = await firecrawlCrawlTool.handler({
            url: 'https://example.com',
        });

        expect(result.isError).toBe(false);
        expect(result.content[0].text).toContain('크롤링 작업 시작됨');
        expect(result.content[0].text).toContain('job_123');
        expect(result.content[0].text).toContain('queued');
    });

    // ==============================
    // Handler Error Cases
    // ==============================

    it('firecrawlScrapeTool.handler returns error when firecrawlPost throws', async () => {
        mockFirecrawlPost.mockRejectedValueOnce(new Error('network error'));

        const result = await firecrawlScrapeTool.handler({
            url: 'https://example.com',
        });

        expect(result.isError).toBe(true);
        expect(result.content[0].text).toContain('스크래핑 실패');
        expect(result.content[0].text).toContain('network error');
    });

    it('firecrawlSearchTool.handler returns error on API failure', async () => {
        mockFirecrawlPost.mockRejectedValueOnce(
            new Error('Firecrawl API 오류 (503): server unavailable')
        );

        const result = await firecrawlSearchTool.handler({
            query: 'failure',
        });

        expect(result.isError).toBe(true);
        expect(result.content[0].text).toContain('검색 실패');
    });

    it('firecrawlCrawlTool.handler returns error on API failure', async () => {
        mockFirecrawlPost.mockRejectedValueOnce(
            new Error('Firecrawl API 오류 (402): insufficient credits')
        );

        const result = await firecrawlCrawlTool.handler({
            url: 'https://example.com',
        });

        expect(result.isError).toBe(true);
        expect(result.content[0].text).toContain('크롤링 시작 실패');
    });
});
