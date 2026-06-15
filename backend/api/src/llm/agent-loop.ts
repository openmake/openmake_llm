/**
 * ============================================================
 * LLM Agent Loop — OpenAI tools multi-turn 호출 루프
 * ============================================================
 *
 * LLMClient.chat() 을 반복 호출하면서 tool_calls 가 등장할 때마다
 * 매핑된 함수 실행 → tool 메시지로 컨버세이션에 누적 → 다시 chat() 호출.
 * tool_calls 가 없으면 종료.
 *
 * 호환: 기존 ollama/agent-loop.ts 의 외부 시그니처 유지.
 *
 * @module llm/agent-loop
 */
import type { LLMClient } from './client';
import type {
    ChatMessage,
    ToolDefinition,
    ThinkOption,
    UsageMetrics,
} from './types';
import { createLogger } from '../utils/logger';
import { AGENT_LOOP_LIMITS } from '../config/runtime-limits';

const logger = createLogger('LLMAgentLoop');

export interface AgentLoopResult {
    messages: ChatMessage[];
    finalMessage: ChatMessage & { metrics?: UsageMetrics };
    iterations: number;
    metrics?: UsageMetrics;
}

export interface AgentLoopParams {
    /** Client instance — 호출자가 모델/베이스 설정 책임 */
    client: LLMClient;
    /** 입력 메시지 (system + user history) */
    messages: ChatMessage[];
    /** LLM 에 노출할 도구 정의 */
    tools: ToolDefinition[];
    /** tool_calls 응답을 실제로 실행할 함수 매핑 */
    availableFunctions: Record<string, (args: Record<string, unknown>) => unknown | Promise<unknown>>;
    /** Reasoning 활성화 옵션 (모델별 의미 다름) */
    think?: ThinkOption;
    /** 스트림 모드 (true 시 onToken 호출) */
    stream?: boolean;
    onToken?: (token: string, thinking?: string) => void;
    onToolCall?: (name: string, args: unknown, result: unknown) => void;
    /** 무한 루프 방지 상한 (기본 10) */
    maxIterations?: number;
}

export async function runAgentLoop(params: AgentLoopParams): Promise<AgentLoopResult> {
    const { client, tools, availableFunctions } = params;
    const maxIterations = params.maxIterations ?? AGENT_LOOP_LIMITS.LEGACY_MAX_ITERATIONS;
    const conversation: ChatMessage[] = [...params.messages];
    let iterations = 0;
    let lastMessage: ChatMessage & { metrics?: UsageMetrics } = {
        role: 'assistant',
        content: '',
    };
    let accumulated: UsageMetrics | undefined;

    while (iterations < maxIterations) {
        iterations++;
        const result = await client.chat(
            conversation,
            undefined,
            params.stream ? params.onToken : undefined,
            { tools, think: params.think },
        );
        lastMessage = result;
        conversation.push({
            role: 'assistant',
            content: result.content,
            ...(result.tool_calls && { tool_calls: result.tool_calls }),
        });

        if (result.metrics) {
            accumulated = {
                prompt_eval_count:
                    (accumulated?.prompt_eval_count ?? 0) + (result.metrics.prompt_eval_count ?? 0),
                eval_count: (accumulated?.eval_count ?? 0) + (result.metrics.eval_count ?? 0),
            };
        }

        if (!result.tool_calls || result.tool_calls.length === 0) {
            return {
                messages: conversation,
                finalMessage: { ...result, metrics: accumulated ?? result.metrics },
                iterations,
                metrics: accumulated,
            };
        }

        for (const tc of result.tool_calls) {
            const name = tc.function.name;
            const fn = availableFunctions[name];
            // tool_call_id 는 vLLM 이 발급한 진짜 id (tc.id) — 다음 턴 vLLM chat_template
            // 렌더링에서 assistant.tool_calls[].id 와 정확히 일치해야 spec 준수.
            if (!fn) {
                logger.warn(`Tool not found: ${name}`);
                conversation.push({
                    role: 'tool',
                    content: `Error: tool ${name} not found`,
                    tool_name: name,
                    tool_call_id: tc.id,
                });
                continue;
            }
            try {
                const toolResult = await fn(tc.function.arguments ?? {});
                const text = typeof toolResult === 'string' ? toolResult : JSON.stringify(toolResult);
                conversation.push({ role: 'tool', content: text, tool_name: name, tool_call_id: tc.id });
                params.onToolCall?.(name, tc.function.arguments, toolResult);
            } catch (e) {
                conversation.push({
                    role: 'tool',
                    content: `Error: ${e instanceof Error ? e.message : String(e)}`,
                    tool_name: name,
                    tool_call_id: tc.id,
                });
            }
        }
    }

    logger.warn(`runAgentLoop: maxIterations ${maxIterations} reached`);
    return {
        messages: conversation,
        finalMessage: { ...lastMessage, metrics: accumulated ?? lastMessage.metrics },
        iterations,
        metrics: accumulated,
    };
}
