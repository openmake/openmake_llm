import {
    normalizeCategory,
    isFalsePositive,
    parseSecurityFindings,
    postProcessFindings,
} from '../analyzer';

describe('normalizeCategory', () => {
    it('표준 카테고리 통과', () => {
        expect(normalizeCategory('sql_injection')).toBe('sql_injection');
    });
    it('공백/하이픈 정규화', () => {
        expect(normalizeCategory('command injection')).toBe('command_injection');
        expect(normalizeCategory('auth-bypass')).toBe('auth_bypass');
    });
    it('미지 카테고리 → other', () => {
        expect(normalizeCategory('weird_thing')).toBe('other');
        expect(normalizeCategory(42)).toBe('other');
    });
});

describe('isFalsePositive', () => {
    it('DoS/ReDoS/로그스푸핑/메모리누수 → 거짓양성', () => {
        expect(isFalsePositive({ title: 'Potential ReDoS in regex' })).toBe(true);
        expect(isFalsePositive({ description: 'log spoofing via user input' })).toBe(true);
        expect(isFalsePositive({ title: 'memory leak in loop' })).toBe(true);
    });
    it('실제 취약점 → 거짓양성 아님', () => {
        expect(isFalsePositive({ category: 'sql_injection', title: 'SQL injection in query', description: 'user input concatenated' })).toBe(false);
    });
});

describe('parseSecurityFindings', () => {
    it('순수 JSON 파싱', () => {
        const r = parseSecurityFindings('{"summary":"s","findings":[{"category":"xss"}]}');
        expect(r.summary).toBe('s');
        expect(r.findings).toHaveLength(1);
    });
    it('코드펜스/머리말 섞여도 추출', () => {
        const r = parseSecurityFindings('설명...\n```json\n{"summary":"x","findings":[]}\n```');
        expect(r.summary).toBe('x');
    });
    it('깨진 JSON → 빈 결과(graceful)', () => {
        const r = parseSecurityFindings('not json at all');
        expect(r.findings).toEqual([]);
    });
    it('빈 입력 → 빈 결과', () => {
        expect(parseSecurityFindings('').findings).toEqual([]);
    });
    // ⚠️ 파싱 실패를 "발견 0건"과 구분한다 — 실패가 "문제 없음"으로 읽히면 안 된다
    // (2026-08-24: skill-rewriter 에서 같은 패턴이 기능을 통째로 죽이고 있었다)
    it('파싱 실패는 parseFailed=true 로 구분한다', () => {
        expect(parseSecurityFindings('전혀 JSON 이 아님').parseFailed).toBe(true);
        expect(parseSecurityFindings('{"summary": 깨진 json').parseFailed).toBe(true);
    });

    it('정상 파싱은 parseFailed 를 세우지 않는다 (findings 가 비어도)', () => {
        const r = parseSecurityFindings('{"summary":"이상 없음","findings":[]}');
        expect(r.parseFailed).toBeUndefined();
        expect(r.findings).toEqual([]);
    });

});

describe('postProcessFindings', () => {
    const opts = { minConfidence: 7, maxFindings: 30 };

    it('신뢰도 게이트: 임계 미만 드롭', () => {
        const raw = [
            { category: 'xss', severity: 'high', title: 'a', confidence: 9 },
            { category: 'xss', severity: 'high', title: 'b', confidence: 5 },
        ];
        const { findings, stats } = postProcessFindings(raw, opts);
        expect(findings).toHaveLength(1);
        expect(stats.droppedLowConfidence).toBe(1);
    });

    it('거짓양성 필터 드롭', () => {
        const raw = [{ category: 'other', severity: 'low', title: 'ReDoS risk', confidence: 9 }];
        const { findings, stats } = postProcessFindings(raw, opts);
        expect(findings).toHaveLength(0);
        expect(stats.droppedFalsePositive).toBe(1);
    });

    it('심각도→신뢰도 내림차순 정렬', () => {
        const raw = [
            { category: 'xss', severity: 'low', title: 'low', confidence: 8 },
            { category: 'sql_injection', severity: 'critical', title: 'crit', confidence: 8 },
            { category: 'ssrf', severity: 'high', title: 'high', confidence: 10 },
        ];
        const { findings } = postProcessFindings(raw, opts);
        expect(findings.map(f => f.severity)).toEqual(['critical', 'high', 'low']);
    });

    it('maxFindings 상한', () => {
        const raw = Array.from({ length: 40 }, (_, i) => ({ category: 'xss', severity: 'medium', title: `t${i}`, confidence: 9 }));
        const { findings } = postProcessFindings(raw, { minConfidence: 7, maxFindings: 30 });
        expect(findings).toHaveLength(30);
    });

    it('잘못된 severity → medium, 비정상 line → null, 신뢰도 클램프', () => {
        const raw = [{ category: 'xss', severity: 'bogus', title: 't', line: -3, confidence: 99 }];
        const { findings } = postProcessFindings(raw, opts);
        expect(findings[0].severity).toBe('medium');
        expect(findings[0].line).toBeNull();
        expect(findings[0].confidence).toBe(10);
    });

    it('객체 아닌 항목 무시', () => {
        const raw = [null, 'x', 42, { category: 'xss', severity: 'high', title: 't', confidence: 8 }];
        const { findings } = postProcessFindings(raw, opts);
        expect(findings).toHaveLength(1);
    });
});
