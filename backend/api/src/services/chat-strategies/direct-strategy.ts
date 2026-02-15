/**
 * ============================================================
 * DirectStrategy - 단일 LLM 직접 호출 전략
 * ============================================================
 *
 * Ollama 클라이언트를 통해 단일 LLM에 한 번 요청하여
 * 응답 텍스트와 도구 호출 정보를 반환하는 기본 전략입니다.
 *
 * @module services/chat-strategies/direct-strategy
 * @description
 * - 단일 턴 LLM 호출 (스트리밍 지원)
 * - 도구 호출 감지 및 어시스턴트 메시지 구성
 * - AgentLoopStrategy의 내부 빌딩 블록으로 사용됨
 */
import type { ChatMessage } from '../../ollama/types';
import type { ChatStrategy, DirectStrategyContext, DirectStrategyResult } from './types';

/**
 * 단일 LLM 직접 호출 전략
 *
 * 대화 히스토리와 도구 목록을 LLM에 전달하고,
 * 응답 텍스트와 도구 호출 정보를 포함한 결과를 반환합니다.
 * tool_calls 토큰은 스트리밍에서 필터링됩니다.
 *
 * @class DirectStrategy
 * @implements {ChatStrategy<DirectStrategyContext, DirectStrategyResult>}
 */
export class DirectStrategy implements ChatStrategy<DirectStrategyContext, DirectStrategyResult> {
    /**
     * 단일 LLM 호출을 실행합니다.
     *
     * @param context - 직접 호출 컨텍스트 (클라이언트, 히스토리, 옵션, 도구 목록)
     * @returns 응답 텍스트, 어시스턴트 메시지, 도구 호출 목록, 메트릭을 포함한 결과
     */
    async execute(context: DirectStrategyContext): Promise<DirectStrategyResult> {
        const response = await context.client.chat(
            context.currentHistory,
            context.chatOptions,
            (token) => {
                // tool_calls JSON 토큰은 스트리밍에서 제외 (클라이언트에 전송하지 않음)
                if (!token.includes('tool_calls')) {
                    context.onToken(token);
                }
            },
            {
                tools: context.allowedTools.length > 0 ? context.allowedTools : undefined,
                think: context.thinkOption,
            }
        );

        // 대화 히스토리에 추가할 어시스턴트 메시지 구성
        const assistantMessage: ChatMessage = {
            role: 'assistant',
            content: response.content || '',
            tool_calls: response.tool_calls,
        };

        return {
            response: response.content || '',
            assistantMessage,
            toolCalls: response.tool_calls || [],
            metrics: response.metrics ? { ...response.metrics } : undefined,
        };
    }
}
