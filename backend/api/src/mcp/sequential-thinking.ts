/**
 * ============================================================
 * Sequential Thinking - 단계별 추론 프롬프트 인젝션
 * ============================================================
 *
 * Thinking 모드 활성화 시 사용자 메시지에 단계별 사고 프로세스 안내를
 * 시스템 프롬프트로 주입합니다.
 *
 * 제어 경로:
 *   Frontend: modes.js → setState('thinkingMode', true)
 *   WebSocket: chat.js → payload.thinkingMode
 *   Backend: ws-chat-handler.ts → ChatService.ts → applySequentialThinking()
 *
 * 참고: 이 기능은 MCP 도구(function calling)가 아니라 프롬프트 인젝션 방식입니다.
 * thinkingMode boolean으로 제어되며, MCP enabledTools 토글과는 무관합니다.
 *
 * @module mcp/sequential-thinking
 */
import { THINKING_LIMITS } from '../config/runtime-limits';

/**
 * Sequential Thinking을 채팅에 적용하기 위한 시스템 프롬프트.
 *
 * 2026-05-26 v2: 출력 형식 강제 (## 결론 → --- → [N/N]) **완전 제거**.
 * vLLM `--reasoning-parser` (Qwen3/EXAONE) + Gemini thinking + Anthropic
 * extended thinking 모두 사고 과정을 native reasoning 채널로 별도 전송하므로
 * 본 prompt 가 본문 형식까지 강제하면 thinking 이 본문에 중복 노출됨.
 *
 * 본 prompt 는 사고 강도만 유도하고 본문은 결론만 출력하도록 지시.
 */
export const SEQUENTIAL_THINKING_SYSTEM_PROMPT = `
복잡한 질문에는 충분히 깊게 사고하되, 사고 과정은 reasoning 채널(<think> 태그 또는 thinking 출력)에만 두고 사용자 응답 본문에는 결론만 자연스럽게 작성합니다. 사용자가 명시적으로 "단계별로 보여줘", "사고 과정을 보여줘" 같이 형식을 요청한 경우에만 본문에 단계 분석을 포함합니다. "## 결론", "---", "[N/N]", "Sequential Thinking", "Thinking Process:" 같은 헤더·메타 표현으로 본문을 시작하지 마세요.
`;

/**
 * 질문에 Sequential Thinking 시스템 프롬프트를 적용
 *
 * 2026-05-26 v2: user message wrap 폐기. 시스템 프롬프트는 별도 system role
 * 메시지로 전달되어야 하며 user 본문에 prepend 하지 않음. 본 함수는 backward
 * compat 위해 시그니처 유지 — enableThinking=true 이어도 user message 는 그대로 반환.
 *
 * thinking 모드 실제 활성화는:
 *   - vLLM: chat_template_kwargs.enable_thinking (LLMClient 자동 전달)
 *   - Gemini OpenAI-compat: native reasoning
 *   - Anthropic: thinking parameter
 *   - System prompt 강도 유도: getThinkingSystemGuidance() 신규 helper 호출
 *
 * @param question - 원본 사용자 질문
 * @param enableThinking - Sequential Thinking 적용 여부 (호환용)
 * @returns 원본 질문 그대로 반환 (wrap 폐기)
 */
export function applySequentialThinking(question: string, _enableThinking: boolean = true): string {
    // 2026-05-26 v2: user message wrap 폐기. system prompt 처리는 별도 경로로 이관.
    return question;
}

/**
 * thinking 모드 활성 시 system prompt 에 추가할 사고 강도 유도 텍스트.
 *
 * 신규 (2026-05-26): applySequentialThinking 의 user message wrap 을 폐기하면서
 * thinking 유도가 필요한 경우 system prompt 로만 전달하기 위한 helper.
 */
export function getThinkingSystemGuidance(enableThinking: boolean): string {
    if (!enableThinking) return '';
    return SEQUENTIAL_THINKING_SYSTEM_PROMPT.trim() + '\n\n';
}

/**
 * Sprint Contract 기반 단계별 사고 프롬프트를 생성합니다.
 *
 * ThinkingStrategy에서 시스템 프롬프트에 주입할 예산 인식 지시를 생성합니다.
 * 기존 SEQUENTIAL_THINKING_SYSTEM_PROMPT를 기반으로 단계 수/토큰 예산을 포함합니다.
 *
 * @param step - 현재 단계 번호
 * @param totalSteps - 총 단계 수
 * @param context - 추가 컨텍스트 (언어, 잔여 예산 등)
 * @returns 단계별 프롬프트 문자열
 */
export function buildThinkingStepPrompt(
    step: number,
    totalSteps: number,
    context?: { language?: string; remainingBudgetRatio?: number }
): string {
    const isAsianLang = context?.language === 'ko' || context?.language === 'ja' || context?.language === 'zh';
    const remainingRatio = context?.remainingBudgetRatio ?? 1.0;

    let prompt = isAsianLang
        ? `[${step}/${totalSteps}] 단계 — `
        : `[${step}/${totalSteps}] Step — `;

    // 잔여 예산이 CRITICAL_THRESHOLD 미만 시 결론 강제 지시
    if (remainingRatio < THINKING_LIMITS.CRITICAL_THRESHOLD) {
        prompt += isAsianLang
            ? '⚠️ 예산 부족. 이 단계에서 최종 결론을 도출하세요.'
            : '⚠️ Budget low. Derive your final conclusion in this step.';
    } else if (remainingRatio < THINKING_LIMITS.WARNING_THRESHOLD) {
        prompt += isAsianLang
            ? '예산의 절반 이상을 사용했습니다. 핵심에 집중하세요.'
            : 'Over half the budget used. Focus on essentials.';
    }

    return prompt;
}
