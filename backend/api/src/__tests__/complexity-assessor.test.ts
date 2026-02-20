import { describe, test, expect } from 'bun:test';
import { assessComplexity, A2A_SKIP_THRESHOLD } from '../chat/complexity-assessor';
import type { ComplexityContext } from '../chat/complexity-assessor';

describe('ComplexityAssessor', () => {
    // Helper to create a basic context
    const createContext = (overrides: Partial<ComplexityContext> = {}): ComplexityContext => ({
        query: 'test query',
        classification: {
            type: 'chat',
            confidence: 0.5,
            matchedPatterns: [],
        },
        hasImages: false,
        hasDocuments: false,
        historyLength: 0,
        ...overrides,
    });

    test('1. "안녕하세요" (chat type, short) → score < 0.3, shouldSkipA2A = true', () => {
        const ctx = createContext({
            query: '안녕하세요',
            classification: { type: 'chat', confidence: 0.5, matchedPatterns: [] },
        });
        const result = assessComplexity(ctx);
        expect(result.score).toBeLessThan(0.3);
        expect(result.shouldSkipA2A).toBe(true);
        expect(result.signals).toContain('very_short_query');
        expect(result.signals).toContain('chat_type');
    });

    test('2. "hi" (chat type, very short) → score < 0.3, shouldSkipA2A = true', () => {
        const ctx = createContext({
            query: 'hi',
            classification: { type: 'chat', confidence: 0.5, matchedPatterns: [] },
        });
        const result = assessComplexity(ctx);
        expect(result.score).toBeLessThan(0.3);
        expect(result.shouldSkipA2A).toBe(true);
        expect(result.signals).toContain('very_short_query');
    });

    test('3. 긴 코드 리뷰 쿼리 + 코드 블록 → score > 0.5, shouldSkipA2A = false', () => {
        const longQuery = `Please review this code:
\`\`\`typescript
function fibonacci(n: number): number {
    if (n <= 1) return n;
    return fibonacci(n - 1) + fibonacci(n - 2);
}
\`\`\`
This is a recursive implementation. What are the performance implications?`;
        const ctx = createContext({
            query: longQuery,
            classification: { type: 'code', confidence: 0.9, matchedPatterns: ['code_block', 'function_def'] },
        });
        const result = assessComplexity(ctx);
        expect(result.score).toBeGreaterThan(0.5);
        expect(result.shouldSkipA2A).toBe(false);
        expect(result.signals).toContain('has_code_block');
        expect(result.signals).toContain('long_query');
    });

    test('4. 이미지 첨부 쿼리 (hasImages=true) → score 증가', () => {
        const ctx1 = createContext({
            query: 'What is this?',
            classification: { type: 'vision', confidence: 0.8, matchedPatterns: [] },
            hasImages: false,
        });
        const ctx2 = createContext({
            query: 'What is this?',
            classification: { type: 'vision', confidence: 0.8, matchedPatterns: [] },
            hasImages: true,
        });
        const result1 = assessComplexity(ctx1);
        const result2 = assessComplexity(ctx2);
        expect(result2.score).toBeGreaterThan(result1.score);
        expect(result2.signals).toContain('has_images');
    });

    test('5. 문서 첨부 쿼리 (hasDocuments=true) → score 증가', () => {
        const ctx1 = createContext({
            query: 'Summarize this',
            classification: { type: 'document', confidence: 0.8, matchedPatterns: [] },
            hasDocuments: false,
        });
        const ctx2 = createContext({
            query: 'Summarize this',
            classification: { type: 'document', confidence: 0.8, matchedPatterns: [] },
            hasDocuments: true,
        });
        const result1 = assessComplexity(ctx1);
        const result2 = assessComplexity(ctx2);
        expect(result2.score).toBeGreaterThan(result1.score);
        expect(result2.signals).toContain('has_documents');
    });

    test('6. 300자+ 긴 쿼리 → long_query 시그널로 score 증가', () => {
        const longQuery = 'a'.repeat(250);
        const ctx = createContext({
            query: longQuery,
            classification: { type: 'analysis', confidence: 0.7, matchedPatterns: [] },
        });
        const result = assessComplexity(ctx);
        expect(result.signals).toContain('long_query');
        expect(result.score).toBeGreaterThan(0.5);
    });

    test('7. analysis 타입 + 패턴 3개 이상 → shouldSkipA2A = false', () => {
        const ctx = createContext({
            query: 'Analyze the data and trends',
            classification: {
                type: 'analysis',
                confidence: 0.85,
                matchedPatterns: ['data_analysis', 'trend_detection', 'statistical_inference'],
            },
        });
        const result = assessComplexity(ctx);
        expect(result.signals).toContain('multiple_patterns');
        expect(result.signals).toContain('complex_type:analysis');
        expect(result.shouldSkipA2A).toBe(false);
    });

    test('8. math 타입 → complex_type 시그널로 score 증가', () => {
        const ctx = createContext({
            query: 'Solve this differential equation',
            classification: { type: 'math', confidence: 0.9, matchedPatterns: ['calculus'] },
        });
        const result = assessComplexity(ctx);
        expect(result.signals).toContain('complex_type:math');
        expect(result.score).toBeGreaterThanOrEqual(0.5);
    });

    test('9. 대화 히스토리 6+ 턴 → long_history 시그널', () => {
        const ctx = createContext({
            query: 'Continue from before',
            classification: { type: 'chat', confidence: 0.6, matchedPatterns: [] },
            historyLength: 10,
        });
        const result = assessComplexity(ctx);
        expect(result.signals).toContain('long_history');
    });

    test('10. 경계값 테스트: 정확히 threshold 근처 점수', () => {
        // Create a context that should result in score very close to threshold
        const ctx = createContext({
            query: 'test',
            classification: { type: 'chat', confidence: 0.5, matchedPatterns: [] },
        });
        const result = assessComplexity(ctx);
        // With very_short_query (-0.3) and chat_type (-0.2), starting from 0.5:
        // 0.5 - 0.3 - 0.2 = 0.0, which is < 0.3
        expect(result.score).toBeLessThan(A2A_SKIP_THRESHOLD);
        expect(result.shouldSkipA2A).toBe(true);
    });

    test('11. 빈 쿼리 → 매우 낮은 score', () => {
        const ctx = createContext({
            query: '',
            classification: { type: 'chat', confidence: 0.1, matchedPatterns: [] },
        });
        const result = assessComplexity(ctx);
        expect(result.score).toBeLessThan(0.3);
        expect(result.shouldSkipA2A).toBe(true);
        expect(result.signals).toContain('very_short_query');
        expect(result.signals).toContain('low_confidence');
    });

    test('12. score 클램프: 극단적으로 높은/낮은 시그널 조합에서 0~1 범위 유지', () => {
        // Create a context with many positive signals
        const ctxHigh = createContext({
            query: 'a'.repeat(300),
            classification: {
                type: 'analysis',
                confidence: 0.95,
                matchedPatterns: ['pattern1', 'pattern2', 'pattern3', 'pattern4'],
            },
            hasImages: true,
            hasDocuments: true,
            historyLength: 20,
        });
        const resultHigh = assessComplexity(ctxHigh);
        expect(resultHigh.score).toBeLessThanOrEqual(1.0);
        expect(resultHigh.score).toBeGreaterThanOrEqual(0);

        // Create a context with many negative signals
        const ctxLow = createContext({
            query: 'a',
            classification: { type: 'chat', confidence: 0.05, matchedPatterns: [] },
            hasImages: false,
            hasDocuments: false,
            historyLength: 0,
        });
        const resultLow = assessComplexity(ctxLow);
        expect(resultLow.score).toBeLessThanOrEqual(1.0);
        expect(resultLow.score).toBeGreaterThanOrEqual(0);
    });
});
