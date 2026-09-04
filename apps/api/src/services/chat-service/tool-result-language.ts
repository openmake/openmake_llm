/**
 * 도구 결과·최종 답변의 문자 체계(script) 비율로 언어 드리프트를 판정하는 순수 함수들 (2026-09-05).
 *
 * - `shouldAppendLanguageNote`: 도구 결과가 대상 언어와 다른 문자 체계면 true → external-tool-batch 가
 *   결과 말미에 리마인더를 붙인다(결정적, LLM 왕복 0).
 * - `detectAnswerLanguageMismatch`: 최종 답변이 대상 언어 문자 체계가 아니면 true → 관측 로그만
 *   (재생성 없음, measure-first).
 * 라틴 문자 언어(en/es/de/fr…)끼리는 문자 체계가 같아 구분하지 않는다 — 이 모듈이 잡는 것은
 * 한국어↔영어 같은 **문자 체계** 드리프트다(실측된 실패 형태).
 *
 * @module services/chat-service/tool-result-language
 */
import { LANGUAGE_PATTERNS } from '../../chat/language-policy';
import { TOOL_RESULT_LANGUAGE_NOTE } from '../../config/runtime-limits';
import { toolResultLanguageNote } from '../../prompts/tool-result-language-note';

const SCRIPT_KEYS = ['ko', 'ja', 'zh', 'ar', 'hi', 'th', 'ru'] as const;
type ScriptKey = (typeof SCRIPT_KEYS)[number] | 'latin';

/** 언어 코드 → 문자 체계 키 (라틴 계열은 전부 'latin') */
export function scriptKeyFor(langCode: string): ScriptKey {
    const base = (langCode || '').toLowerCase().split(/[-_]/)[0];
    return (SCRIPT_KEYS as readonly string[]).includes(base) ? (base as ScriptKey) : 'latin';
}

/** 판정 대상 문자만 남긴다 — 코드블록·URL·아티팩트 참조·공백·숫자·구두점 제외 */
export function stripForScriptRatio(text: string): string {
    return (text || '')
        .replace(/```[\s\S]*?```/g, '')
        .replace(/https?:\/\/\S+/g, '')
        .replace(/\[\[artifact:[^\]]+\]\]/g, '')
        .replace(/[\s\d\p{P}\p{S}]/gu, '');
}

/** text 안에서 대상 언어 문자 체계가 차지하는 비율 (판정 가능한 글자가 없으면 null) */
export function targetScriptRatio(text: string, langCode: string): number | null {
    const letters = stripForScriptRatio(text);
    if (letters.length === 0) return null;
    const key = scriptKeyFor(langCode);
    const pattern = LANGUAGE_PATTERNS[key];
    const hits = (letters.match(pattern) || []).length;
    return hits / letters.length;
}

/** 도구 결과에 언어 리마인더를 붙여야 하는가 */
export function shouldAppendLanguageNote(toolResult: string, langCode: string | undefined): boolean {
    if (!TOOL_RESULT_LANGUAGE_NOTE.ENABLED || !langCode) return false;
    if ((toolResult || '').length < TOOL_RESULT_LANGUAGE_NOTE.MIN_RESULT_CHARS) return false;
    const ratio = targetScriptRatio(toolResult, langCode);
    return ratio !== null && ratio <= TOOL_RESULT_LANGUAGE_NOTE.MAX_TARGET_SCRIPT_RATIO;
}

/** 리마인더를 붙인 도구 결과 (조건 미충족이면 원문 그대로) */
export function withLanguageNote(toolResult: string, langCode: string | undefined): string {
    return shouldAppendLanguageNote(toolResult, langCode) && langCode
        ? `${toolResult}\n\n${toolResultLanguageNote(langCode)}`
        : toolResult;
}

/** 최종 답변이 대상 언어 문자 체계가 아닌가 (관측용) */
export function detectAnswerLanguageMismatch(answer: string, langCode: string | undefined): boolean {
    if (!langCode) return false;
    const letters = stripForScriptRatio(answer);
    if (letters.length < TOOL_RESULT_LANGUAGE_NOTE.GUARD_MIN_ANSWER_CHARS) return false;
    const ratio = targetScriptRatio(answer, langCode);
    return ratio !== null && ratio <= TOOL_RESULT_LANGUAGE_NOTE.MAX_TARGET_SCRIPT_RATIO;
}
