/**
 * chat-service-formatters 단위 테스트
 *
 * 테스트 범위:
 * - formatResearchResult: 연구 결과 마크다운 포맷팅 (헤더, 요약, 발견사항, 참고자료, 통계)
 * - formatDiscussionResult: 멀티 에이전트 토론 결과 마크다운 포맷팅
 */
import { formatResearchResult } from '../format';

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

