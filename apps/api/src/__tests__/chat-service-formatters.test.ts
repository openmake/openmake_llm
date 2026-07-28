/**
 * chat-service-formatters 단위 테스트
 *
 * 테스트 범위:
 * - formatResearchResult: 연구 결과 마크다운 포맷팅 (헤더, 요약, 발견사항, 참고자료, 통계)
 * - formatDiscussionResult: 멀티 에이전트 토론 결과 마크다운 포맷팅
 */
import { formatResearchResult, formatDiscussionResult } from '../services/chat-service-formatters';
import type { DiscussionResult } from '../agents/discussion-types';

// ─────────────────────────────────────────────
// formatResearchResult 테스트
// ─────────────────────────────────────────────

describe('formatResearchResult', () => {
    // formatResearchResult 는 report-generator 가 만든 **완전한 보고서**(summary)를
    // 그대로 출력하고 통계 메타 라인만 덧붙인다. keyFindings/sources 를 직접 재조립하지 않는다
    // (과거 삼중 중복 제거). 따라서 헤더·섹션·참고문헌은 summary 안에 이미 들어 있다.
    const baseResult = {
        topic: 'TypeScript 제네릭',
        summary: [
            '# 🔬 심층 연구 보고서: TypeScript 제네릭',
            '',
            '## 📋 종합 요약',
            '',
            'TypeScript 제네릭은 타입 안정성을 높이는 강력한 도구입니다.',
            '',
            '## 📚 참고 자료',
            '',
            '[1] [TypeScript 공식 문서](https://www.typescriptlang.org/docs)',
        ].join('\n'),
        keyFindings: ['타입 파라미터 사용', '제약 조건 지원'],
        sources: [
            { title: 'TypeScript 공식 문서', url: 'https://www.typescriptlang.org/docs' },
            { title: 'TypeScript Handbook', url: 'https://www.typescriptlang.org/handbook' },
        ],
        totalSteps: 5,
        duration: 3000,
    };

    test('보고서(summary)가 그대로 출력된다', () => {
        const result = formatResearchResult(baseResult);
        expect(result).toContain('# 🔬 심층 연구 보고서: TypeScript 제네릭');
        expect(result).toContain('TypeScript 제네릭은 타입 안정성을 높이는 강력한 도구입니다.');
    });

    test('summary 내 마크다운 섹션·참고문헌이 보존된다', () => {
        const result = formatResearchResult(baseResult);
        expect(result).toContain('## 📋 종합 요약');
        expect(result).toContain('[1] [TypeScript 공식 문서](https://www.typescriptlang.org/docs)');
    });

    test('구분선(---)이 포함된다', () => {
        const result = formatResearchResult(baseResult);
        expect(result).toContain('---');
    });

    test('통계 footer에 단계 수, 소스 수, 소요 시간이 포함된다', () => {
        const result = formatResearchResult(baseResult);
        expect(result).toContain('*총 5단계 연구, 2개 소스 분석, 3.0초 소요*');
    });

    test('duration이 밀리초에서 초로 변환된다 (소수점 1자리)', () => {
        const result = formatResearchResult({ ...baseResult, duration: 12500 });
        expect(result).toContain('12.5초 소요');
    });

    test('duration이 1000ms이면 1.0초로 표시된다', () => {
        const result = formatResearchResult({ ...baseResult, duration: 1000 });
        expect(result).toContain('1.0초 소요');
    });

    test('빈 sources 배열이면 0개 소스로 표시된다', () => {
        const result = formatResearchResult({ ...baseResult, sources: [] });
        expect(result).toContain('0개 소스 분석');
    });

    test('빈 summary도 정상 처리된다 (meta footer만 출력)', () => {
        const result = formatResearchResult({ ...baseResult, summary: '' });
        expect(result).toContain('---');
        expect(result).toContain('*총 5단계 연구');
    });

    test('totalSteps 0일 때 통계에 0단계로 표시된다', () => {
        const result = formatResearchResult({ ...baseResult, totalSteps: 0 });
        expect(result).toContain('*총 0단계 연구');
    });

    test('반환값은 줄바꿈으로 결합된 문자열이다', () => {
        const result = formatResearchResult(baseResult);
        expect(typeof result).toBe('string');
        expect(result.includes('\n')).toBe(true);
    });
});

// ─────────────────────────────────────────────
// formatDiscussionResult 테스트
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

    test('종합 답변이 details 태그로 감싸진다', () => {
        const result = formatDiscussionResult(baseResult);
        expect(result).toContain('<details open>');
        expect(result).toContain('<summary>💡 <strong>종합 답변</strong> (전문가 의견 종합)</summary>');
        expect(result).toContain('</details>');
    });

    test('finalAnswer가 details 태그 안에 포함된다', () => {
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
