/**
 * 슬래시 스킬 호출 시 **답변 언어 판정 입력**이 확장문이 아니라 사용자 원문이어야 한다.
 *
 * 실측 (2026-08-25): 영어 본문 스킬을 한국어로 호출하면 확장문 기준 감지가 en(0.80) 으로
 * 떨어져 minConfidence 0.7 을 넘고, 답변이 영어로 나갔다. 반대로 원문을 그대로 쓰면
 * `/slug` 만 친 경우 ASCII 슬러그를 보고 영어로 판정한다 — 둘 다 막아야 한다.
 */
import { buildAugmentedMessage, languageDetectionInput } from '../chat/slash-command';
import { determineLanguagePolicy } from '../chat/language-policy';

const EN_SKILL = {
    name: 'Code Review',
    content: 'You are a senior reviewer. Examine the diff for correctness, security and performance issues. '
        + 'Report findings ranked by severity with file and line references.',
};
const KO_SKILL = {
    name: '엔진엑스 로그 분석',
    content: '당신은 Nginx 로그를 분석하는 DevOps 전문가입니다. 오류를 집계하고 보고서를 만듭니다.',
};
const CFG = {
    defaultLanguage: 'ko' as const, enableDynamicResponse: true, minConfidenceThreshold: 0.7,
    shortTextThreshold: 20, fallbackLanguage: 'en' as const,
    supportedLanguages: ['ko', 'en', 'ja', 'zh'] as const as never,
};
const resolved = (text: string) => determineLanguagePolicy(text, CFG).resolvedLanguage;

describe('languageDetectionInput', () => {
    it('슬래시가 아니면 원문 그대로', () => {
        expect(languageDetectionInput('nginx 로그 분석해줘', 'nginx 로그 분석해줘')).toBe('nginx 로그 분석해줘');
    });

    it('슬러그 뒤 인자가 있으면 인자만 (스킬 본문 언어에 덮이지 않는다)', () => {
        const raw = '/code-review 이 코드 리뷰해줘';
        const expanded = buildAugmentedMessage(EN_SKILL, '이 코드 리뷰해줘');
        expect(languageDetectionInput(raw, expanded)).toBe('이 코드 리뷰해줘');
    });

    it('슬러그만 치면 확장문 (ASCII 슬러그로 영어 판정하지 않는다)', () => {
        const raw = '/엔진엑스-로그-분석';
        const expanded = buildAugmentedMessage(KO_SKILL, '');
        expect(languageDetectionInput(raw, expanded)).toBe(expanded);
    });
});

describe('답변 언어 — 실측 결함 재현과 해소', () => {
    it('영어 스킬 + 한국어 질문: 확장문 기준이면 en 으로 뒤집힌다 (결함)', () => {
        expect(resolved(buildAugmentedMessage(EN_SKILL, '이 코드 리뷰해줘'))).toBe('en');
    });

    it('영어 스킬 + 한국어 질문: 원문 기준이면 ko (해소)', () => {
        const input = languageDetectionInput('/code-review 이 코드 리뷰해줘', buildAugmentedMessage(EN_SKILL, '이 코드 리뷰해줘'));
        expect(resolved(input)).toBe('ko');
    });

    it('한국어 스킬 슬러그만: 원문(슬러그)이면 en 오판, 헬퍼는 ko 유지', () => {
        const raw = '/엔진엑스-로그-분석';
        const expanded = buildAugmentedMessage(KO_SKILL, '');
        // 슬러그는 한글이라도 짧아 폴백 → 오판 위험을 헬퍼가 확장문 폴백으로 막는다
        expect(resolved(languageDetectionInput(raw, expanded))).toBe('ko');
    });

    it('영어 스킬 + 영어 질문: 그대로 en', () => {
        const input = languageDetectionInput('/code-review review this diff please', buildAugmentedMessage(EN_SKILL, 'review this diff please'));
        expect(resolved(input)).toBe('en');
    });
});
