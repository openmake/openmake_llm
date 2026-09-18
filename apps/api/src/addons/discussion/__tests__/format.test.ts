/**
 * chat-service-formatters 단위 테스트
 *
 * 테스트 범위:
 * - formatResearchResult: 연구 결과 마크다운 포맷팅 (헤더, 요약, 발견사항, 참고자료, 통계)
 * - formatDiscussionResult: 멀티 에이전트 토론 결과 마크다운 포맷팅
 */
import { formatDiscussionResult } from '../format';
import type { DiscussionResult } from '../types';

// ─────────────────────────────────────────────
// formatResearchResult 테스트
// ─────────────────────────────────────────────

describe('formatDiscussionResult', () => {
    const makeOpinion = (overrides: Partial<DiscussionResult['opinions'][number]> = {}): DiscussionResult['opinions'][number] => ({
        agentId: 'agent-1',
        agentName: '기술 전문가',
        agentEmoji: '🔧',
        opinion: '기술적 관점에서 TypeScript가 더 안전합니다.',
        confidence: 0.9,
        timestamp: new Date('2026-01-01T00:00:00Z'),
        ...overrides,
    });

    const baseResult: DiscussionResult = {
        discussionSummary: '3명의 전문가가 2라운드 토론 완료',
        finalAnswer: '## 최종 답변\n\nTypeScript 사용을 권장합니다.',
        participants: ['기술 전문가', '보안 전문가', '성능 전문가'],
        opinions: [
            makeOpinion({ agentId: 'agent-1', agentName: '기술 전문가', agentEmoji: '🔧', opinion: '기술적으로 TypeScript가 우수합니다.' }),
            makeOpinion({ agentId: 'agent-2', agentName: '보안 전문가', agentEmoji: '🛡️', opinion: '보안 측면에서도 TypeScript가 안전합니다.' }),
        ],
        totalTime: 5000,
        factChecked: false,
    };

    test('멀티 에이전트 토론 결과 헤더가 포함된다', () => {
        const result = formatDiscussionResult(baseResult);
        expect(result).toContain('## 🎯 멀티 에이전트 토론 결과');
    });

    test('discussionSummary가 인용 형식으로 포함된다', () => {
        const result = formatDiscussionResult(baseResult);
        expect(result).toContain('> 3명의 전문가가 2라운드 토론 완료');
    });

    test('전문가별 분석 섹션 헤더가 포함된다', () => {
        const result = formatDiscussionResult(baseResult);
        expect(result).toContain('## 📋 전문가별 분석');
    });

    test('각 에이전트의 agentEmoji와 agentName이 헤더에 포함된다', () => {
        const result = formatDiscussionResult(baseResult);
        expect(result).toContain('### 🔧 기술 전문가');
        expect(result).toContain('### 🛡️ 보안 전문가');
    });

    test('각 에이전트의 thinking 문구가 포함된다', () => {
        const result = formatDiscussionResult(baseResult);
        expect(result).toContain('> 💭 **Thinking**: 기술 전문가 관점에서 분석 중...');
        expect(result).toContain('> 💭 **Thinking**: 보안 전문가 관점에서 분석 중...');
    });

    test('각 에이전트의 opinion이 포함된다', () => {
        const result = formatDiscussionResult(baseResult);
        expect(result).toContain('기술적으로 TypeScript가 우수합니다.');
        expect(result).toContain('보안 측면에서도 TypeScript가 안전합니다.');
    });

    // 2026-09-13: raw HTML(<details>) → 마크다운 헤딩. 프론트 마크다운 렌더러는 XSS 방어로
    // rehype-raw 를 쓰지 않아 태그가 렌더되지 않고 닫는 </details> 가 본문에 노출됐다.
    test('종합 답변이 마크다운 헤딩으로 구분된다 (raw HTML 금지)', () => {
        const result = formatDiscussionResult(baseResult);
        expect(result).toContain('## 💡 종합 답변 (전문가 의견 종합)');
        expect(result).not.toContain('<details');
        expect(result).not.toContain('</details>');
        expect(result).not.toContain('<summary>');
    });

    test('finalAnswer가 종합 답변 섹션에 포함된다', () => {
        const result = formatDiscussionResult(baseResult);
        expect(result).toContain('## 최종 답변\n\nTypeScript 사용을 권장합니다.');
    });

    test('구분선(---)이 포함된다', () => {
        const result = formatDiscussionResult(baseResult);
        expect(result).toContain('---');
    });

    test('opinions가 빈 배열이면 에이전트 섹션이 비어 있다', () => {
        const result = formatDiscussionResult({ ...baseResult, opinions: [] });
        expect(result).toContain('## 📋 전문가별 분석');
        expect(result).not.toContain('### ');
    });

    test('단일 opinion만 있어도 정상 포맷팅된다', () => {
        const result = formatDiscussionResult({
            ...baseResult,
            opinions: [makeOpinion()],
        });
        expect(result).toContain('### 🔧 기술 전문가');
        expect(result).not.toContain('### 🛡️ 보안 전문가');
    });

    test('반환값은 문자열이다', () => {
        const result = formatDiscussionResult(baseResult);
        expect(typeof result).toBe('string');
    });

    test('여러 에이전트가 있을 때 각각 구분선으로 분리된다', () => {
        const result = formatDiscussionResult(baseResult);
        // 섹션 구분선은 한 번 이상 등장해야 함
        const separatorCount = (result.match(/---/g) ?? []).length;
        expect(separatorCount).toBeGreaterThanOrEqual(2);
    });
});
