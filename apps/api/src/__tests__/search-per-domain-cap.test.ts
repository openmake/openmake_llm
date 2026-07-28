/**
 * search-per-domain-cap.test.ts
 *
 * applyPerDomainCap — 도메인당 상한으로 소스 다양성 보호 (단계4 품질 개선).
 * news.google.com RSS 도배로 diversity 가 붕괴(3.8%)하던 라이브 문제 대응.
 */
import { applyPerDomainCap } from '../mcp/web-search/search-orchestrator';
import type { SearchResult } from '../mcp/web-search/types';

const r = (url: string): SearchResult => ({ title: url, url, snippet: '' }) as unknown as SearchResult;

describe('applyPerDomainCap', () => {
    test('단일 도메인 도배 → cap 으로 제한', () => {
        // news.google.com 8개 + 다른 도메인 2개 (점수순 가정)
        const sorted = [
            r('https://news.google.com/a'), r('https://news.google.com/b'),
            r('https://news.google.com/c'), r('https://news.google.com/d'),
            r('https://news.google.com/e'), r('https://news.google.com/f'),
            r('https://en.wikipedia.org/x'), r('https://docs.vllm.ai/y'),
        ];
        const out = applyPerDomainCap(sorted, 20, 3);
        const domains = out.map(s => new URL(s.url).hostname);
        // news.google.com 은 3개로 제한, 나머지 도메인은 그대로
        expect(domains.filter(d => d === 'news.google.com').length).toBe(3);
        expect(domains).toContain('en.wikipedia.org');
        expect(domains).toContain('docs.vllm.ai');
        expect(out.length).toBe(5); // 3(news) + wiki + vllm
    });

    test('www. 정규화 — www 유무가 같은 도메인으로 집계', () => {
        const sorted = [r('https://www.a.com/1'), r('https://a.com/2'), r('https://a.com/3')];
        const out = applyPerDomainCap(sorted, 20, 2);
        expect(out.length).toBe(2); // a.com 으로 합쳐 cap 2
    });

    test('maxResults 가 cap 보다 먼저 적용', () => {
        const sorted = [r('https://a.com/1'), r('https://b.com/2'), r('https://c.com/3')];
        expect(applyPerDomainCap(sorted, 2, 5).length).toBe(2);
    });

    test('cap<=0 → 비활성 (단순 slice, 기존 동작)', () => {
        const sorted = [r('https://a.com/1'), r('https://a.com/2'), r('https://a.com/3')];
        expect(applyPerDomainCap(sorted, 10, 0).length).toBe(3);
    });

    test('URL 파싱 실패 결과는 cap 미적용으로 통과', () => {
        const sorted = [r('not-a-url'), r('also bad'), r('https://a.com/1')];
        const out = applyPerDomainCap(sorted, 10, 1);
        expect(out.length).toBe(3); // 파싱 실패 2개 + a.com 1개
    });
});
