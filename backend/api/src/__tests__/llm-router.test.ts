/**
 * llm-router.test.ts
 * getAgentSummaries(), isValidAgentId() 단위 테스트
 * routeWithLLM()은 OllamaClient LLM 호출이 필요하므로 테스트 범위 제외
 */

import { getAgentSummaries, isValidAgentId } from '../agents/llm-router';
import industryData from '../agents/industry-agents.json';
import { AgentCategory } from '../agents/types';

// ============================================================
// getAgentSummaries() 테스트
// ============================================================

describe('getAgentSummaries()', () => {
    test('비어있지 않은 배열을 반환한다', () => {
        const summaries = getAgentSummaries();
        expect(Array.isArray(summaries)).toBe(true);
        expect(summaries.length).toBeGreaterThan(0);
    });

    test('각 요약 항목은 id, name, category, description을 가진다', () => {
        const summaries = getAgentSummaries();
        for (const summary of summaries) {
            expect(typeof summary.id).toBe('string');
            expect(summary.id.length).toBeGreaterThan(0);
            expect(typeof summary.name).toBe('string');
            expect(summary.name.length).toBeGreaterThan(0);
            expect(typeof summary.category).toBe('string');
            expect(summary.category.length).toBeGreaterThan(0);
            expect(typeof summary.description).toBe('string');
            expect(summary.description.length).toBeGreaterThan(0);
        }
    });

    test('industry-agents.json의 전체 에이전트 수와 일치한다', () => {
        const summaries = getAgentSummaries();
        let expectedCount = 0;
        for (const [, category] of Object.entries(industryData as Record<string, AgentCategory>)) {
            expectedCount += category.agents.length;
        }
        expect(summaries.length).toBe(expectedCount);
    });

    test('software-engineer 에이전트가 포함된다', () => {
        const summaries = getAgentSummaries();
        const found = summaries.find(s => s.id === 'software-engineer');
        expect(found).toBeDefined();
    });

    test('중복 id가 없다', () => {
        const summaries = getAgentSummaries();
        const ids = summaries.map(s => s.id);
        const uniqueIds = new Set(ids);
        expect(uniqueIds.size).toBe(ids.length);
    });

    test('category 필드는 industry-agents.json의 name 필드에서 온다', () => {
        const summaries = getAgentSummaries();
        const categoryNames = new Set(
            Object.values(industryData as Record<string, AgentCategory>).map(c => c.name)
        );
        for (const summary of summaries) {
            expect(categoryNames).toContain(summary.category);
        }
    });

    test('호출할 때마다 동일한 결과를 반환한다 (순수함수)', () => {
        const first = getAgentSummaries();
        const second = getAgentSummaries();
        expect(first.length).toBe(second.length);
        expect(first.map(s => s.id)).toEqual(second.map(s => s.id));
    });
});

// ============================================================
// isValidAgentId() 테스트
// ============================================================

describe('isValidAgentId()', () => {
    test('industry-agents.json에 존재하는 id → true', () => {
        expect(isValidAgentId('software-engineer')).toBe(true);
    });

    test('"general" → true (기본 에이전트)', () => {
        expect(isValidAgentId('general')).toBe(true);
    });

    test('존재하지 않는 id → false', () => {
        expect(isValidAgentId('non-existent-agent-xyz')).toBe(false);
    });

    test('빈 문자열 → false', () => {
        expect(isValidAgentId('')).toBe(false);
    });

    test('대소문자 불일치 → false (정확한 매칭)', () => {
        expect(isValidAgentId('Software-Engineer')).toBe(false);
        expect(isValidAgentId('GENERAL')).toBe(false);
    });

    test('getAgentSummaries()에서 가져온 모든 id는 유효하다', () => {
        const summaries = getAgentSummaries();
        for (const summary of summaries) {
            expect(isValidAgentId(summary.id)).toBe(true);
        }
    });

    test('부분 문자열 → false', () => {
        // "software-engineer"의 부분 문자열은 유효하지 않음
        expect(isValidAgentId('software')).toBe(false);
        expect(isValidAgentId('engineer')).toBe(false);
    });
});
