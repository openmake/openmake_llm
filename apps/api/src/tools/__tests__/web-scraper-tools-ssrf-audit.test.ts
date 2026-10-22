/**
 * web_scrape·web_map·web_crawl 의 SSRF 차단 감사(S10) — 차단 오류는 security.ssrf_blocked 로 남기되
 * resourceId 는 host 만(URL 전체·경로·쿼리는 남기지 않는다). 도구 반환값(isError 결과)은 종전 그대로.
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
jest.mock('../../security/security-audit', () => ({
    ...jest.requireActual('../../security/security-audit'),
    auditSecurityEvent: jest.fn().mockResolvedValue(undefined),
}));

import { webScrapeTool, webMapTool, webCrawlTool } from '../web-scraper-tools';
import { auditSecurityEvent } from '../../security/security-audit';

const audit = auditSecurityEvent as jest.Mock;
const ctx = { userId: 'u-7', role: 'user' as const };
const URL_WITH_SECRET = 'http://internal.example:8080/admin?token=abc';
const ssrf = () => new Error('SSRF blocked: resolved to blocked IP range: 10.0.0.1');

describe('web-scraper 도구 × SSRF 차단 감사', () => {
    beforeEach(() => {
        audit.mockClear();
        mockScrapePage.mockReset();
        mockMapSiteUrls.mockReset();
        mockCrawlSite.mockReset();
    });

    it('web_scrape: SSRF 차단 → isError 결과 + security.ssrf_blocked 1회(host 만)', async () => {
        mockScrapePage.mockRejectedValue(ssrf());
        const result = await webScrapeTool.handler({ url: URL_WITH_SECRET }, ctx);
        expect(result.isError).toBe(true);
        expect(result.content[0].text).toContain('스크래핑 실패: SSRF blocked');
        await new Promise((r) => setImmediate(r));
        expect(audit).toHaveBeenCalledTimes(1);
        const input = audit.mock.calls[0][0];
        expect(input).toMatchObject({
            action: 'security.ssrf_blocked', userId: 'u-7', resourceType: 'url', resourceId: 'internal.example:8080',
        });
        expect(input.details).toEqual({ tool: 'web_scrape', reason: 'SSRF blocked: resolved to blocked IP range: 10.0.0.1' });
        expect(JSON.stringify(input)).not.toContain('/admin');
        expect(JSON.stringify(input)).not.toContain('token=abc');
    });

    it('web_map·web_crawl: SSRF 차단도 도구 이름으로 감사한다', async () => {
        mockMapSiteUrls.mockRejectedValue(ssrf());
        mockCrawlSite.mockRejectedValue(ssrf());
        expect((await webMapTool.handler({ url: URL_WITH_SECRET }, ctx)).isError).toBe(true);
        expect((await webCrawlTool.handler({ url: URL_WITH_SECRET }, ctx)).isError).toBe(true);
        await new Promise((r) => setImmediate(r));
        expect(audit.mock.calls.map((c) => c[0].details.tool)).toEqual(['web_map', 'web_crawl']);
        expect(audit.mock.calls.every((c) => c[0].resourceId === 'internal.example:8080')).toBe(true);
    });

    it('URL 이 깨졌으면 resourceId 는 invalid', async () => {
        mockScrapePage.mockRejectedValue(ssrf());
        await webScrapeTool.handler({ url: 'not a url' }, ctx);
        await new Promise((r) => setImmediate(r));
        expect(audit.mock.calls[0][0].resourceId).toBe('invalid');
    });

    it('일반 오류는 감사하지 않는다', async () => {
        mockScrapePage.mockRejectedValue(new Error('timeout'));
        const result = await webScrapeTool.handler({ url: 'https://example.com' }, ctx);
        expect(result.isError).toBe(true);
        await new Promise((r) => setImmediate(r));
        expect(audit).not.toHaveBeenCalled();
    });
});
