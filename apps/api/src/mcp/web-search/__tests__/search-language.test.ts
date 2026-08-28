import { resolveSearchLanguage } from '../search-language';

describe('resolveSearchLanguage', () => {
    it('명시 언어가 있으면 그대로 쓴다', () => {
        expect(resolveSearchLanguage('AI 기본법 시행령 2026', 'en')).toBe('en');
        expect(resolveSearchLanguage('AI policy 2026', 'ko')).toBe('ko');
    });

    it('한국어 질의는 ko 로 감지한다 — 네이버·다음 provider 가 실행되는 조건', () => {
        expect(resolveSearchLanguage('AI 기본법 시행령 2026')).toBe('ko');
        expect(resolveSearchLanguage('제조업 AI 파운데이션 모델 한국 2026')).toBe('ko');
    });

    it('영어 질의는 en 이다', () => {
        expect(resolveSearchLanguage('Obsidian app download growth stats 2025')).toBe('en');
    });

    it('빈 문자열은 en 폴백', () => {
        expect(resolveSearchLanguage('')).toBe('en');
    });
});
