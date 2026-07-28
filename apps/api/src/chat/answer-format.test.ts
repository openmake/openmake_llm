import {
    resolveAnswerFormatProfile,
    getAnswerFormatGuard,
    applyAnswerFormat,
} from './answer-format';

describe('answer-format: resolveAnswerFormatProfile', () => {
    it('concise 스타일은 항상 prose (구조 강제 제외)', () => {
        expect(resolveAnswerFormatProfile({ style: 'concise', promptType: 'reasoning' })).toBe('prose');
        expect(resolveAnswerFormatProfile({ style: 'concise', promptType: 'consultant' })).toBe('prose');
    });

    it('구조적 promptType 은 structured', () => {
        for (const t of ['reasoning', 'coder', 'reviewer', 'consultant', 'security'] as const) {
            expect(resolveAnswerFormatProfile({ style: 'default', promptType: t })).toBe('structured');
        }
    });

    it('일상/번역/agent 유형은 prose', () => {
        for (const t of ['assistant', 'translator', 'agent'] as const) {
            expect(resolveAnswerFormatProfile({ style: 'default', promptType: t })).toBe('prose');
            expect(resolveAnswerFormatProfile({ style: 'verbose', promptType: t })).toBe('prose');
        }
    });

    it('promptType 미제공 시 message 로 detectPromptType 재사용', () => {
        // 코딩 질문 → coder 계열로 분류되어 structured
        const code = resolveAnswerFormatProfile({
            style: 'default',
            message: '이 함수에서 발생하는 TypeError 버그를 어떻게 디버깅하고 수정해야 해? 코드도 보여줘',
        });
        expect(code).toBe('structured');

        // 단순 인사 → assistant → prose
        const casual = resolveAnswerFormatProfile({ style: 'default', message: '안녕 반가워' });
        expect(casual).toBe('prose');
    });
});

describe('answer-format: getAnswerFormatGuard', () => {
    it('prose 는 빈 문자열 (overhead 0)', () => {
        expect(getAnswerFormatGuard('prose', 'ko')).toBe('');
        expect(getAnswerFormatGuard('prose', 'en')).toBe('');
    });

    it('structured 는 언어별 가드 — 결론-우선 지시 포함', () => {
        const ko = getAnswerFormatGuard('structured', 'ko');
        expect(ko).toContain('결론');
        expect(ko).toContain('표');

        const en = getAnswerFormatGuard('structured', 'en');
        expect(en.toLowerCase()).toContain('conclusion');
        expect(en.toLowerCase()).toContain('table');
    });
});

describe('answer-format: applyAnswerFormat', () => {
    const base = 'SYSTEM BASE PROMPT';

    it('prose 는 systemPrompt 를 그대로 반환', () => {
        expect(applyAnswerFormat(base, 'prose', 'ko')).toBe(base);
    });

    it('structured 는 가드를 prepend 하고 base 를 보존', () => {
        const out = applyAnswerFormat(base, 'structured', 'ko');
        expect(out).toContain('답변 형식');
        expect(out).toContain(base);
        expect(out.indexOf('답변 형식')).toBeLessThan(out.indexOf(base));
    });
});
