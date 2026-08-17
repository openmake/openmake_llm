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

describe('answer-format: compactScreen (모바일 클라이언트)', () => {
    it('structured + compact 는 기존 가드 뒤에 화면 폭 지시를 덧붙인다', () => {
        const plain = getAnswerFormatGuard('structured', 'ko');
        const compact = getAnswerFormatGuard('structured', 'ko', { compactScreen: true });
        expect(compact.startsWith(plain)).toBe(true);
        expect(compact).toContain("열은 3개 이하");
    });

    it('prose + compact 는 폭 지시만 주입 (구조 강제 없음)', () => {
        const compact = getAnswerFormatGuard('prose', 'ko', { compactScreen: true });
        expect(compact).toContain("열은 3개 이하");
        expect(compact).not.toContain('결론을 가장 먼저');
    });

    it('compact 미지정은 기존 동작 유지 (overhead 0)', () => {
        expect(getAnswerFormatGuard('prose', 'ko')).toBe('');
        expect(getAnswerFormatGuard('prose', 'en')).toBe('');
    });

    it('영어 로케일도 폭 지시를 제공', () => {
        const compact = getAnswerFormatGuard('structured', 'en', { compactScreen: true });
        expect(compact).toContain("three columns or fewer");
    });
});
