/**
 * ============================================================
 * Response Style — per-session 응답 형식 가드
 * ============================================================
 *
 * claude.ai 의 Style dropdown (Default / Concise / Explanatory / Formal)
 * 동등 기능. 사용자가 채팅 입력 영역에서 chip 으로 선택. system prompt 에
 * prepend 으로 작동.
 *
 * Style ≠ Custom Instructions 의 차이:
 *   - Style: 시스템 정의 3개 옵션, per-session toggle
 *   - Custom Instructions: 사용자 자유 작성, 영구 (users.custom_instructions)
 *
 * 도입 배경 (2026-05-26): Phase B Phase 2-A 완료 후 brand profile 7개를
 * 직교 축 (Model · Style · Mode · CI) 로 재구성. brand profile 의 응답 형식
 * 관련 의미 (Concise/Fast 등) 를 본 모듈이 흡수.
 *
 * @module chat/style
 * @see docs/superpowers/plans/2026-05-26-brand-profile-decomposition.md
 */

import { resolvePromptLocale } from './language-policy';

export type Style = 'concise' | 'default' | 'verbose';

export const VALID_STYLES: readonly Style[] = ['concise', 'default', 'verbose'] as const;

/**
 * 사용자 입력의 style 필드를 검증 + 정규화. 미지원/null 은 'default'.
 */
export function normalizeStyle(input: unknown): Style {
    if (typeof input !== 'string') return 'default';
    const lower = input.toLowerCase();
    if (lower === 'concise' || lower === 'verbose' || lower === 'default') {
        return lower as Style;
    }
    return 'default';
}

/**
 * Style 별 prepend 텍스트. 언어 인식 (ko / en).
 * Default 는 빈 문자열 — `getResponseDiscipline` 의 기본 가드가 이미 적용됨.
 */
export function getStyleGuard(style: Style, userLanguage: string): string {
    if (style === 'default') return '';
    const locale = resolvePromptLocale(userLanguage);
    if (locale === 'ko') {
        if (style === 'concise') {
            return `## ⚡ 응답 스타일: 간결 (Concise)
- 핵심만 한두 줄로 답변. 불릿·표·헤더는 사용자가 명시 요청한 경우에만.
- 근거·예시·메타 설명 생략. 사용자가 "왜?" 또는 "예시?" 를 명시했을 때만 보강.

`;
        }
        // verbose
        return `## 📚 응답 스타일: 상세 (Verbose)
- 결론에 도달한 근거·맥락·예시를 포함하여 상세히 설명.
- 관련 개념·트레이드오프·대안을 함께 제시. 학습용 깊이의 답변.

`;
    }
    // en
    if (style === 'concise') {
        return `## ⚡ Response Style: Concise
- Answer the core in one or two lines. Bullets/tables/headers only if user explicitly asks.
- Omit rationale, examples, meta-commentary. Add only when user asks "why?" or "example?".

`;
    }
    return `## 📚 Response Style: Verbose
- Include rationale, context, and examples that led to the conclusion.
- Present related concepts, trade-offs, and alternatives. Depth suitable for learning.

`;
}

/**
 * combinedSystemPrompt 앞에 style guard 를 prepend.
 * default 일 때는 그대로 반환 (overhead 0).
 */
export function applyStyle(systemPrompt: string, style: Style, userLanguage: string): string {
    const guard = getStyleGuard(style, userLanguage);
    return guard ? `${guard}---\n\n${systemPrompt}` : systemPrompt;
}
