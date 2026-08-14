/**
 * detectSearxngCategories — 질의 성격별 SearXNG 카테고리 스코프 (결정적 regex).
 * 기술 질의 → it, 학술 질의 → science, 일반 질의 → undefined (기존 동작 무변경).
 */
import { detectSearxngCategories } from '../mcp/web-search/search-orchestrator';

describe('detectSearxngCategories', () => {
    test('기술/개발 질의 → general,it', () => {
        expect(detectSearxngCategories('React 렌더링 에러 해결 방법')).toBe('general,it');
        expect(detectSearxngCategories('docker compose 설정')).toBe('general,it');
        expect(detectSearxngCategories('typescript 제네릭 사용법')).toBe('general,it');
    });

    test('학술/논문 질의 → general,science', () => {
        expect(detectSearxngCategories('transformer 관련 논문 찾아줘')).toBe('general,science');
        expect(detectSearxngCategories('arxiv preprint attention mechanism')).toBe('general,science');
    });

    test('기술+학술 동시 매칭 → general,it,science', () => {
        expect(detectSearxngCategories('llm 추론 최적화 논문과 python 구현 코드')).toBe('general,it,science');
    });

    test('일반 질의 → undefined (기본 general 유지)', () => {
        expect(detectSearxngCategories('오늘 서울 날씨 알려줘')).toBeUndefined();
        expect(detectSearxngCategories('manus.ai 에 대해서 조사해줘')).toBeUndefined();
        expect(detectSearxngCategories('김치찌개 맛있게 끓이는 법')).toBeUndefined();
    });
});
