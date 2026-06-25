/**
 * ============================================================
 * Answer Format — intent-gated 답변 구조 가드
 * ============================================================
 *
 * 사용자 요청(2026-06-26): 답변 스타일 일관성 개선. 의사결정·비교·문제해결·
 * 기술설계 같은 "구조적 답변이 적합한" 질문에 한해 결론-우선·문단 절제·표/실행
 * 항목 분리 형식을 system prompt 로 강제한다.
 *
 * 설계 결정 — JSON 구조화 출력이 아닌 프롬프트 레이어:
 *   채팅은 WebSocket 토큰 스트리밍이라 JSON Schema 강제는 (1) 응답 완료까지 빈
 *   화면 = 스트리밍 UX 소실, (2) 로컬 qwen3.6 strict-JSON 불안정 문제가 있다.
 *   따라서 LLM 이 자유 텍스트를 스트리밍하되 "뼈대"만 프롬프트로 고정한다.
 *
 * 게이트 (profile):
 *   - style==='concise' → 'prose' (간결 스타일은 한두 줄 답변이 목적이므로 침범 금지)
 *   - promptType 이 구조적 유형(reasoning/coder/consultant 등) → 'structured'
 *   - 그 외(assistant/translator/agent = 일상·잡담·번역) → 'prose'
 *   'prose' 일 때는 가드 미주입 → RESPONSE_DISCIPLINE_TEXTS 의 산문 기본값 유지.
 *
 * Style 축과의 관계: Style(concise/default/verbose)은 "분량", Answer Format 은
 * "뼈대 구조" 를 통제하는 직교 축. 둘 다 default 경로에서 overhead 0.
 *
 * @module chat/answer-format
 */

import { resolvePromptLocale } from './language-policy';
import { ANSWER_FORMAT_TEXTS } from './prompt-locales';
import { detectPromptType } from './prompt-templates';
import type { PromptType } from './prompt-templates';
import type { Style } from './style';

export type AnswerFormatProfile = 'structured' | 'prose';

/**
 * 구조적 답변이 적합한 PromptType 집합.
 * 제외: assistant(일상 대화), translator(번역), agent(도구 실행 — 자체 형식).
 */
const STRUCTURED_PROMPT_TYPES: ReadonlySet<PromptType> = new Set<PromptType>([
    'reasoning',
    'coder',
    'reviewer',
    'explainer',
    'generator',
    'researcher',
    'consultant',
    'security',
    'writer',
]);

/**
 * 답변 형식 profile 결정. promptType 미제공 시 message 로부터 detectPromptType 재사용
 * (신규 classifier 도입 금지 — 기존 regex 분류기 단일 사용).
 */
export function resolveAnswerFormatProfile(opts: {
    style: Style;
    promptType?: PromptType;
    message?: string;
}): AnswerFormatProfile {
    // 간결 스타일은 형식 강제 대상에서 제외 (사용자 명시 의도 우선).
    if (opts.style === 'concise') return 'prose';

    const type = opts.promptType
        ?? (opts.message ? detectPromptType(opts.message) : 'assistant');

    return STRUCTURED_PROMPT_TYPES.has(type) ? 'structured' : 'prose';
}

/**
 * profile 별 prepend 텍스트. 'prose' 는 빈 문자열(overhead 0).
 */
export function getAnswerFormatGuard(profile: AnswerFormatProfile, userLanguage: string): string {
    if (profile === 'prose') return '';
    const locale = resolvePromptLocale(userLanguage);
    return locale === 'ko' ? ANSWER_FORMAT_TEXTS.ko : ANSWER_FORMAT_TEXTS.en;
}

/**
 * systemPrompt 앞에 answer-format 가드를 prepend. style.ts 의 applyStyle 과 동일 규약.
 * 'prose' 일 때는 그대로 반환.
 */
export function applyAnswerFormat(
    systemPrompt: string,
    profile: AnswerFormatProfile,
    userLanguage: string,
): string {
    const guard = getAnswerFormatGuard(profile, userLanguage);
    return guard ? `${guard}---\n\n${systemPrompt}` : systemPrompt;
}
