/**
 * deep-research-metrics.test.ts
 *
 * 단계8 측정 토대 — computeResearchMetrics / extractDomain 결정적 단위 테스트.
 * DeepResearchService 가 step 2000 으로 영속하는 measure-only 메트릭의 산술 정확성 검증.
 */

import { computeResearchMetrics, extractDomain } from '../services/deep-research-utils';
import type { SearchResult } from '../mcp/web-search';

const src = (url: string): SearchResult => ({ title: url, url, snippet: '' }) as unknown as SearchResult;

describe('extractDomain', () => {
    test('http/https/www 정규화', () => {
        expect(extractDomain('https://www.A.com/path')).toBe('a.com');
        expect(extractDomain('http://b.org')).toBe('b.org');
        expect(extractDomain('c.net/x')).toBe('c.net'); // 스킴 없으면 https 가정
    });
    test('파싱 불가 → null', () => {
        expect(extractDomain('not a url')).toBeNull();
        expect(extractDomain('')).toBeNull();
    });
});

describe('computeResearchMetrics', () => {
    test('도메인 중복 제거 + diversity 산출', () => {
        const sources = [
            src('https://a.com/1'),
            src('https://a.com/2'), // 같은 도메인
            src('https://b.org/x'),
            src('https://c.net/y'),
        ];
        const m = computeResearchMetrics({ sources, scrapedCount: 3, loopsExecuted: 2, durationMs: 1234 });
        expect(m.sourceCount).toBe(4);
        expect(m.uniqueDomains).toBe(3);          // a.com, b.org, c.net
        expect(m.sourceDiversity).toBeCloseTo(3 / 4, 5);
        expect(m.scrapedCount).toBe(3);
        expect(m.loopsExecuted).toBe(2);
        expect(m.durationMs).toBe(1234);
    });

    test('소스 0 → diversity 0 (0 나눗셈 안전)', () => {
        const m = computeResearchMetrics({ sources: [], scrapedCount: 0, loopsExecuted: 1, durationMs: 10 });
        expect(m.sourceCount).toBe(0);
        expect(m.uniqueDomains).toBe(0);
        expect(m.sourceDiversity).toBe(0);
    });

    test('파싱 불가 URL 은 도메인 집계에서 제외', () => {
        const m = computeResearchMetrics({
            sources: [src('https://a.com'), src('garbage')],
            scrapedCount: 1, loopsExecuted: 1, durationMs: 5,
        });
        expect(m.sourceCount).toBe(2);     // 소스 수는 그대로
        expect(m.uniqueDomains).toBe(1);   // a.com 만 집계
    });
});
