/**
 * 도구 결과 말미에 붙이는 응답 언어 리마인더 (2026-09-05).
 * 대상 언어로 써야 효과가 있으므로 한국어는 한국어, 그 외는 영어+언어명.
 * @module prompts/tool-result-language-note
 */
import { LANGUAGE_DISPLAY_NAMES, resolvePromptLocale, type SupportedLanguageCode } from '../chat/language-policy';

export function toolResultLanguageNote(langCode: string): string {
    if (resolvePromptLocale(langCode) === 'ko') {
        return '[시스템] 위 도구 결과는 다른 언어로 작성돼 있습니다. 최종 답변은 반드시 한국어로 작성하고, 인용·코드 설명도 한국어로 옮기세요(코드 자체는 그대로).';
    }
    const name = LANGUAGE_DISPLAY_NAMES[langCode as SupportedLanguageCode] || langCode;
    return `[system] The tool output above is in a different language. Write the final answer in ${name}, translating quotes and explanations (code itself stays as-is).`;
}
