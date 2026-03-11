/**
 * deep-research-utils.ts 단위 테스트
 * 7개 순수 유틸리티 함수 검증
 */

import {
    deduplicateSources,
    normalizeUrl,
    clampImportance,
    buildFallbackSubTopics,
    chunkArray,
    extractBulletLikeFindings,
    getLoopProgressRange,
} from '../domains/research/deep-research-utils';
import type { SearchResult } from '../mcp/web-search';

// ===== normalizeUrl =====

describe('normalizeUrl', () => {
    test('https:// 제거', () => {
        expect(normalizeUrl('https://example.com')).toBe('example.com');
    });

    test('http:// 제거', () => {
        expect(normalizeUrl('http://example.com')).toBe('example.com');
    });

    test('트레일링 슬래시 제거', () => {
        expect(normalizeUrl('https://example.com/')).toBe('example.com');
    });

    test('소문자로 변환: 프로토콜 제거 후 lowercase 적용', () => {
        // HTTP:// 는 regex /^https?:\/\// 에 매칭되지 않음(case-sensitive)
        // 하지만 toLowerCase()로 전체가 소문자화됨
        expect(normalizeUrl('https://EXAMPLE.COM')).toBe('example.com');
    });

    test('앞뒤 공백 제거', () => {
        expect(normalizeUrl('  https://example.com  ')).toBe('example.com');
    });

    test('경로 포함 URL 정규화', () => {
        expect(normalizeUrl('https://example.com/path/to/page')).toBe('example.com/path/to/page');
    });

    test('쿼리스트링 포함 URL 정규화', () => {
        expect(normalizeUrl('https://example.com/search?q=test')).toBe('example.com/search?q=test');
    });

    test('프로토콜 없는 URL은 그대로', () => {
        expect(normalizeUrl('example.com')).toBe('example.com');
    });
});

// ===== deduplicateSources =====

describe('deduplicateSources', () => {
    function makeSource(url: string, title = 'title'): SearchResult {
        return { url, title, snippet: '', source: 'web' };
    }

    test('중복 URL 제거 (동일 URL)', () => {
        const sources = [
            makeSource('https://example.com'),
            makeSource('https://example.com'),
        ];
        const result = deduplicateSources(sources);
        expect(result).toHaveLength(1);
    });

    test('정규화 후 동일한 URL 제거 (trailing slash 차이)', () => {
        const sources = [
            makeSource('https://example.com/'),
            makeSource('https://example.com'),
        ];
        const result = deduplicateSources(sources);
        expect(result).toHaveLength(1);
    });

    test('정규화 후 동일한 URL 제거 (http vs https)', () => {
        const sources = [
            makeSource('https://example.com'),
            makeSource('http://example.com'),
        ];
        const result = deduplicateSources(sources);
        expect(result).toHaveLength(1);
    });

    test('서로 다른 URL은 모두 유지', () => {
        const sources = [
            makeSource('https://a.com'),
            makeSource('https://b.com'),
            makeSource('https://c.com'),
        ];
        const result = deduplicateSources(sources);
        expect(result).toHaveLength(3);
    });

    test('빈 배열은 빈 배열 반환', () => {
        expect(deduplicateSources([])).toEqual([]);
    });

    test('첫 번째 항목이 유지됨 (순서 보장)', () => {
        const sources = [
            makeSource('https://example.com', 'first'),
            makeSource('https://example.com', 'second'),
        ];
        const result = deduplicateSources(sources);
        expect(result[0].title).toBe('first');
    });
});

// ===== clampImportance =====

describe('clampImportance', () => {
    test('정상 범위 값은 그대로', () => {
        expect(clampImportance(1)).toBe(1);
        expect(clampImportance(3)).toBe(3);
        expect(clampImportance(5)).toBe(5);
    });

    test('undefined → 3 (기본값)', () => {
        expect(clampImportance(undefined)).toBe(3);
    });

    test('NaN → 3 (기본값)', () => {
        expect(clampImportance(NaN)).toBe(3);
    });

    test('0 → 1 (최솟값 클램핑)', () => {
        expect(clampImportance(0)).toBe(1);
    });

    test('음수 → 1 (최솟값 클램핑)', () => {
        expect(clampImportance(-10)).toBe(1);
    });

    test('6 → 5 (최댓값 클램핑)', () => {
        expect(clampImportance(6)).toBe(5);
    });

    test('100 → 5 (최댓값 클램핑)', () => {
        expect(clampImportance(100)).toBe(5);
    });

    test('소수 반올림: 2.5 → 3', () => {
        expect(clampImportance(2.5)).toBe(3);
    });

    test('소수 반올림: 2.4 → 2', () => {
        expect(clampImportance(2.4)).toBe(2);
    });

    test('소수 반올림 후 클램핑: 4.7 → 5', () => {
        expect(clampImportance(4.7)).toBe(5);
    });
});

// ===== buildFallbackSubTopics =====

describe('buildFallbackSubTopics', () => {
    test('항상 8개 서브토픽 반환', () => {
        const topics = buildFallbackSubTopics('AI');
        expect(topics).toHaveLength(8);
    });

    test('각 서브토픽에 topic이 포함된 title', () => {
        const topics = buildFallbackSubTopics('블록체인');
        topics.forEach(t => {
            expect(t.title).toContain('블록체인');
        });
    });

    test('각 서브토픽에 searchQueries 배열 존재', () => {
        const topics = buildFallbackSubTopics('AI');
        topics.forEach(t => {
            expect(Array.isArray(t.searchQueries)).toBe(true);
            expect(t.searchQueries.length).toBeGreaterThan(0);
        });
    });

    test('importance 값은 모두 1~5 범위', () => {
        const topics = buildFallbackSubTopics('AI');
        topics.forEach(t => {
            expect(t.importance).toBeGreaterThanOrEqual(1);
            expect(t.importance).toBeLessThanOrEqual(5);
        });
    });

    test('첫 번째 서브토픽의 importance는 5 (가장 중요)', () => {
        const topics = buildFallbackSubTopics('AI');
        expect(topics[0].importance).toBe(5);
    });

    test('빈 topic 문자열도 처리', () => {
        const topics = buildFallbackSubTopics('');
        expect(topics).toHaveLength(8);
    });
});

// ===== chunkArray =====

describe('chunkArray', () => {
    test('기본 분할: [1,2,3,4,5], size=2 → [[1,2],[3,4],[5]]', () => {
        expect(chunkArray([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    });

    test('딱 나누어지는 경우: [1,2,3,4], size=2 → [[1,2],[3,4]]', () => {
        expect(chunkArray([1, 2, 3, 4], 2)).toEqual([[1, 2], [3, 4]]);
    });

    test('size=1 → 각 원소가 별도 배열', () => {
        expect(chunkArray([1, 2, 3], 1)).toEqual([[1], [2], [3]]);
    });

    test('size >= 배열 길이 → 단일 청크', () => {
        expect(chunkArray([1, 2, 3], 10)).toEqual([[1, 2, 3]]);
    });

    test('빈 배열 → 빈 배열', () => {
        expect(chunkArray([], 2)).toEqual([]);
    });

    test('size=0 → max(1, 0)=1이므로 각 원소 별도 배열', () => {
        expect(chunkArray([1, 2, 3], 0)).toEqual([[1], [2], [3]]);
    });

    test('제네릭: 문자열 배열도 처리', () => {
        expect(chunkArray(['a', 'b', 'c', 'd'], 3)).toEqual([['a', 'b', 'c'], ['d']]);
    });

    test('size=3: [1,2,3,4,5,6,7] → [[1,2,3],[4,5,6],[7]]', () => {
        expect(chunkArray([1, 2, 3, 4, 5, 6, 7], 3)).toEqual([[1, 2, 3], [4, 5, 6], [7]]);
    });
});

// ===== extractBulletLikeFindings =====

describe('extractBulletLikeFindings', () => {
    test('- 로 시작하는 줄 추출', () => {
        const text = '- 첫번째 항목\n- 두번째 항목\n- 세번째 항목';
        const result = extractBulletLikeFindings(text);
        expect(result).toEqual(['첫번째 항목', '두번째 항목', '세번째 항목']);
    });

    test('숫자. 로 시작하는 줄 추출', () => {
        const text = '1. 항목 하나\n2. 항목 둘\n3. 항목 셋';
        const result = extractBulletLikeFindings(text);
        expect(result).toEqual(['항목 하나', '항목 둘', '항목 셋']);
    });

    test('불릿과 숫자 혼합', () => {
        const text = '- 불릿 항목\n1. 숫자 항목';
        const result = extractBulletLikeFindings(text);
        expect(result).toEqual(['불릿 항목', '숫자 항목']);
    });

    test('일반 텍스트 줄은 무시', () => {
        const text = '일반 텍스트\n- 불릿 항목\n또 다른 텍스트';
        const result = extractBulletLikeFindings(text);
        expect(result).toEqual(['불릿 항목']);
    });

    test('최대 20개로 제한', () => {
        const lines = Array.from({ length: 25 }, (_, i) => `- 항목 ${i + 1}`).join('\n');
        const result = extractBulletLikeFindings(lines);
        expect(result).toHaveLength(20);
    });

    test('빈 문자열 → 빈 배열', () => {
        expect(extractBulletLikeFindings('')).toEqual([]);
    });

    test('빈 줄은 무시', () => {
        const text = '- 항목\n\n- ';
        const result = extractBulletLikeFindings(text);
        // '- ' → '' (trim 후 빈 문자열) → 필터링됨
        expect(result).toEqual(['항목']);
    });

    test('앞뒤 공백 포함된 불릿 항목 정리', () => {
        const text = '  - 공백 포함 항목  ';
        const result = extractBulletLikeFindings(text);
        expect(result).toEqual(['공백 포함 항목']);
    });
});

// ===== getLoopProgressRange =====

describe('getLoopProgressRange', () => {
    test('loopIndex=0, maxLoops=4 — 기본 범위 계산', () => {
        const range = getLoopProgressRange(0, 4);
        // loopSpan = 80/4 = 20, loopBase = 5 + 0 = 5
        expect(range.searchStart).toBeCloseTo(5, 5);
        expect(range.searchEnd).toBeCloseTo(5 + 20 / 3, 5);
        expect(range.scrapeStart).toBeCloseTo(5 + 20 / 3, 5);
        expect(range.scrapeEnd).toBeCloseTo(5 + (20 / 3) * 2, 5);
        expect(range.synthesizeStart).toBeCloseTo(5 + (20 / 3) * 2, 5);
        expect(range.synthesizeEnd).toBeCloseTo(5 + 20, 5);
    });

    test('loopIndex=1, maxLoops=4 — 두 번째 루프', () => {
        const range = getLoopProgressRange(1, 4);
        // loopSpan = 20, loopBase = 5 + 20 = 25
        expect(range.searchStart).toBeCloseTo(25, 5);
        expect(range.synthesizeEnd).toBeCloseTo(45, 5);
    });

    test('마지막 루프 (loopIndex=maxLoops-1)', () => {
        const range = getLoopProgressRange(3, 4);
        // loopBase = 5 + 60 = 65, synthesizeEnd = 65 + 20 = 85
        expect(range.searchStart).toBeCloseTo(65, 5);
        expect(range.synthesizeEnd).toBeCloseTo(85, 5);
    });

    test('synthStart === scrapeEnd (alias)', () => {
        const range = getLoopProgressRange(0, 4);
        expect(range.synthStart).toBe(range.scrapeEnd);
    });

    test('synthesizeStart === scrapeEnd (alias)', () => {
        const range = getLoopProgressRange(0, 4);
        expect(range.synthesizeStart).toBe(range.scrapeEnd);
    });

    test('scrapeStart === searchEnd', () => {
        const range = getLoopProgressRange(0, 4);
        expect(range.scrapeStart).toBe(range.searchEnd);
    });

    test('단일 루프: maxLoops=1', () => {
        const range = getLoopProgressRange(0, 1);
        // loopSpan = 80, loopBase = 5
        expect(range.searchStart).toBeCloseTo(5, 5);
        expect(range.synthesizeEnd).toBeCloseTo(85, 5);
    });
});
