/**
 * ============================================================
 * Agent Loop Messages - 도구 호출 루프 제어 메시지
 * ============================================================
 *
 * AgentLoopStrategy 가 루프 제어를 위해 대화에 주입하는 메시지 텍스트.
 * (시스템 프롬프트 인라인 금지 정책에 따라 외부화)
 *
 * @module prompts/agent-loop-messages
 * @see services/chat-strategies/agent-loop-strategy.ts
 */

/**
 * Doom Loop 강제 종료 알림 — 동일 도구 호출 반복 임계값 초과로 루프 탈출 시 주입.
 * user role 로 전달 (일부 모델은 대화 중간 system role 거부).
 */
export const DOOM_LOOP_TERMINATED_NOTICE =
    '[System Notice] The same tool call has been repeated and the loop has been forcefully terminated. Based on results so far, provide the best possible answer to the user. Explain what approach failed and suggest alternatives.';

/**
 * Doom Loop 경고 — 동일 패턴 반복 감지 시 접근법 변경 유도 (종료 전 1회).
 */
export const DOOM_LOOP_WARNING_NOTICE =
    '[System Notice] You are repeating the same tool call with the same arguments. The previous approach is failing. Try a different tool, different arguments, or ask the user for more information.';

/**
 * PreCompletion Checklist 보충 수정 프롬프트 빌더.
 * 자체 검증에서 발견된 이슈 목록만 수정하도록 지시.
 */
export const buildPreCompletionFixPrompt = (issueList: string): string =>
    `Your previous response had these issues:\n${issueList}\n\nProvide ONLY the corrections for these issues. Do not repeat the full response.`;
