import {
    normalizeDimension,
    isReviewNoise,
    parseReviewFindings,
    postProcessReview,
} from '../reviewer';

const opts = { minConfidence: 7, maxFindings: 30 };

describe('normalizeDimension', () => {
    it('표준 차원 통과 + 정규화', () => {
        expect(normalizeDimension('bug')).toBe('bug');
        expect(normalizeDimension('error handling')).toBe('error_handling');
    });
    it('미지 → other', () => {
        expect(normalizeDimension('vibes')).toBe('other');
        expect(normalizeDimension(7)).toBe('other');
    });
});

describe('isReviewNoise', () => {
    it('스타일/네이밍/문서화 권고 → 노이즈', () => {
        expect(isReviewNoise({ title: '들여쓰기 일관성' })).toBe(true);
        expect(isReviewNoise({ description: 'naming convention 위반' })).toBe(true);
        expect(isReviewNoise({ suggestion: 'consider documenting this function' })).toBe(true);
    });
    it('실제 버그 → 노이즈 아님', () => {
        expect(isReviewNoise({ title: '널 역참조 가능', description: 'x가 null일 때 크래시' })).toBe(false);
    });
});

describe('parseReviewFindings', () => {
    it('JSON/코드펜스/깨짐 처리', () => {
        expect(parseReviewFindings('{"summary":"s","findings":[]}').summary).toBe('s');
        expect(parseReviewFindings('```json\n{"findings":[{"dimension":"bug"}]}\n```').findings).toHaveLength(1);
        expect(parseReviewFindings('garbage').findings).toEqual([]);
    });
    // ⚠️ 파싱 실패를 "발견 0건"과 구분한다 — 실패가 "문제 없음"으로 읽히면 안 된다
    // (2026-08-24: skill-rewriter 에서 같은 패턴이 기능을 통째로 죽이고 있었다)
    it('파싱 실패는 parseFailed=true 로 구분한다', () => {
        expect(parseReviewFindings('전혀 JSON 이 아님').parseFailed).toBe(true);
        expect(parseReviewFindings('{"summary": 깨진 json').parseFailed).toBe(true);
    });

    it('정상 파싱은 parseFailed 를 세우지 않는다 (findings 가 비어도)', () => {
        const r = parseReviewFindings('{"summary":"이상 없음","findings":[]}');
        expect(r.parseFailed).toBeUndefined();
        expect(r.findings).toEqual([]);
    });

});

describe('postProcessReview', () => {
    it('신뢰도 게이트', () => {
        const raw = [
            { dimension: 'bug', severity: 'high', title: 'a', confidence: 9 },
            { dimension: 'bug', severity: 'high', title: 'b', confidence: 4 },
        ];
        const { findings, stats } = postProcessReview(raw, opts);
        expect(findings).toHaveLength(1);
        expect(stats.droppedLowConfidence).toBe(1);
    });

    it('스타일 노이즈 드롭', () => {
        const raw = [{ dimension: 'maintainability', severity: 'low', title: '세미콜론 누락', confidence: 9 }];
        const { findings, stats } = postProcessReview(raw, opts);
        expect(findings).toHaveLength(0);
        expect(stats.droppedFalsePositive).toBe(1);
    });

    it('심각도→신뢰도 정렬', () => {
        const raw = [
            { dimension: 'bug', severity: 'low', title: 'l', confidence: 8 },
            { dimension: 'bug', severity: 'critical', title: 'c', confidence: 7 },
        ];
        const { findings } = postProcessReview(raw, opts);
        expect(findings[0].severity).toBe('critical');
    });

    it('상한 + 잘못된 필드 보정', () => {
        const many = Array.from({ length: 40 }, (_, i) => ({ dimension: 'bug', severity: 'x', title: `t${i}`, line: -1, confidence: 50 }));
        const { findings } = postProcessReview(many, { minConfidence: 7, maxFindings: 10 });
        expect(findings).toHaveLength(10);
        expect(findings[0].severity).toBe('medium');
        expect(findings[0].line).toBeNull();
        expect(findings[0].confidence).toBe(10);
    });

    it('객체 아닌 항목 무시', () => {
        const { findings } = postProcessReview([null, 3, 'x', { dimension: 'bug', severity: 'high', title: 't', confidence: 8 }], opts);
        expect(findings).toHaveLength(1);
    });
});
