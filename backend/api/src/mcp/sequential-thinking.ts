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

/**
 * Sequential Thinking을 채팅에 적용하기 위한 시스템 프롬프트
 */
export const SEQUENTIAL_THINKING_SYSTEM_PROMPT = `
당신은 Sequential Thinking을 사용하여 문제를 단계별로 분석하는 AI 어시스턴트입니다.

복잡한 질문에 답할 때 다음 프로세스를 따르세요:

1. **문제 분해**: 질문을 여러 단계로 나눕니다
2. **단계별 분석**: 각 단계를 순서대로 분석합니다
3. **가설 생성**: 분석을 바탕으로 가설을 세웁니다
4. **가설 검증**: 가설이 올바른지 확인합니다
5. **수정 및 개선**: 필요한 경우 이전 단계를 수정합니다

**중요: 답변 구조 규칙**
반드시 **결론(최종 답변)을 맨 먼저** 제시하고, 그 아래에 사고 과정을 보여주세요.

출력 순서:
1. \`## 결론\` — 최종 답변을 먼저 명확하게 제시
2. \`---\` — 구분선
3. 사고 과정 — 각 단계를 [1/N], [2/N] 형식으로 표시
`;

/**
 * 질문에 Sequential Thinking 시스템 프롬프트를 적용
 *
 * enableThinking=true일 때, 원본 질문에 단계별 사고 프로세스 안내를 추가합니다.
 * false이면 원본 질문을 그대로 반환합니다.
 *
 * @param question - 원본 사용자 질문
 * @param enableThinking - Sequential Thinking 적용 여부 (기본값: true)
 * @returns Sequential Thinking 프롬프트가 적용된 질문 문자열
 */
export function applySequentialThinking(question: string, enableThinking: boolean = true): string {
    if (!enableThinking) {
        return question;
    }

    return `${SEQUENTIAL_THINKING_SYSTEM_PROMPT}

사용자 질문: ${question}

위 질문에 대해 먼저 최종 결론을 "## 결론" 제목으로 제시한 후, "---" 구분선 아래에 단계별 사고 과정을 [단계번호/총단계] 형식으로 보여주세요.
`;
}
