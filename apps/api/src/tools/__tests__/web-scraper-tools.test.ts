/**
 * Web Scraper MCP Tools Unit Tests
 *
 * web-scraper.ts의 scrapePage, mapSiteUrls, crawlSite를 mock하여
 * MCP 도구 핸들러 로직을 테스트합니다.
 */

const mockScrapePage = jest.fn();
const mockMapSiteUrls = jest.fn();
const mockCrawlSite = jest.fn();

jest.mock('../../utils/web-scraper', () => ({
    scrapePage: mockScrapePage,
    mapSiteUrls: mockMapSiteUrls,
    crawlSite: mockCrawlSite,
}));

jest.mock('../../security/ssrf-guard', () => ({
    validateOutboundUrl: jest.fn(() => Promise.resolve(new URL('https://example.com'))),
}));

import {
    webScrapeTool,
    webMapTool,
    webCrawlTool,
    webScraperTools,
} from '../web-scraper-tools';

describe('web-scraper MCP tools', () => {
    afterEach(() => {
        mockScrapePage.mockReset();
        mockMapSiteUrls.mockReset();
        mockCrawlSite.mockReset();
    });

    // ==============================
    // Tool Array
    // ==============================

    it('webScraperTools array has 3 tools', () => {
        expect(webScraperTools.length).toBe(3);
        const names = webScraperTools.map(t => t.tool.name);
        expect(names).toContain('web_scrape');
        expect(names).toContain('web_map');
        expect(names).toContain('web_crawl');
    });

    // ==============================
    // Schema Validation
    // ==============================

    it('each tool has required inputSchema', () => {
        expect(webScrapeTool.tool.inputSchema.required).toContain('url');
        expect(webMapTool.tool.inputSchema.required).toContain('url');
        expect(webCrawlTool.tool.inputSchema.required).toContain('url');
    });

    // ==============================
    // web_scrape
    // ==============================

    it('webScrapeTool returns markdown content on success', async () => {
        mockScrapePage.mockResolvedValueOnce({
            markdown: '# Sample Markdown',
            title: 'Sample Page',
            links: [],
        });

        const result = await webScrapeTool.handler({ url: 'https://example.com' });

        expect(result.isError).toBe(false);
        expect(result.content[0].text).toContain('스크래핑 완료');
        expect(result.content[0].text).toContain('# Sample Markdown');
    });

    it('webScrapeTool returns error on failure', async () => {
        mockScrapePage.mockRejectedValueOnce(new Error('network error'));

        const result = await webScrapeTool.handler({ url: 'https://example.com' });

        expect(result.isError).toBe(true);
        expect(result.content[0].text).toContain('스크래핑 실패');
        expect(result.content[0].text).toContain('network error');
    });

    // ==============================
    // web_map
    // ==============================

    it('webMapTool returns mapped URLs on success', async () => {
        mockMapSiteUrls.mockResolvedValueOnce([
            'https://example.com',
            'https://example.com/docs',
        ]);

        const result = await webMapTool.handler({ url: 'https://example.com' });

        expect(result.isError).toBe(false);
        expect(result.content[0].text).toContain('URL 매핑 결과 (2개 발견)');
        expect(result.content[0].text).toContain('1. https://example.com');
        expect(result.content[0].text).toContain('2. https://example.com/docs');
    });

    it('webMapTool returns error on failure', async () => {
        mockMapSiteUrls.mockRejectedValueOnce(new Error('timeout'));

        const result = await webMapTool.handler({ url: 'https://example.com' });

        expect(result.isError).toBe(true);
        expect(result.content[0].text).toContain('URL 매핑 실패');
    });

    // ==============================
    // web_crawl
    // ==============================

    it('webCrawlTool returns crawled pages on success', async () => {
        mockCrawlSite.mockResolvedValueOnce([
            { url: 'https://example.com', markdown: 'Home page content', title: 'Home' },
            { url: 'https://example.com/about', markdown: 'About page content', title: 'About' },
        ]);

        const result = await webCrawlTool.handler({ url: 'https://example.com' });

        expect(result.isError).toBe(false);
        expect(result.content[0].text).toContain('크롤링 완료 (2개 페이지)');
        expect(result.content[0].text).toContain('Home');
        expect(result.content[0].text).toContain('About');
    });

    it('webCrawlTool returns error on failure', async () => {
        mockCrawlSite.mockRejectedValueOnce(new Error('crawl failed'));

        const result = await webCrawlTool.handler({ url: 'https://example.com' });

        expect(result.isError).toBe(true);
        expect(result.content[0].text).toContain('크롤링 실패');
    });
});
