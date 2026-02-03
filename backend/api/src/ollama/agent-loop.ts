/**
 * Ollama Cloud Multi-turn Tool Calling Agent Loop
 * 
 * 공식 문서 참고: https://docs.ollama.com/capabilities/tool-calling#multi-turn-tool-calling-agent-loop
 * 
 * 이 모듈은 Ollama의 Tool Calling 기능을 활용한 Agent Loop를 구현합니다.
 * - Multi-turn 대화에서 자동으로 도구를 호출하고 결과를 다시 LLM에 전달
 * - Streaming 지원으로 실시간 응답 가능
 * - 무한 루프 방지를 위한 maxIterations 설정
 */

import { Ollama, Message, Tool, ToolCall, ChatResponse } from 'ollama';
import { ChatMessage, ToolDefinition, ThinkOption, UsageMetrics } from './types';
import { getApiKeyManager } from './api-key-manager';
import { getConfig } from '../config';

const envConfig = getConfig();

// Ollama Cloud 호스트
const OLLAMA_CLOUD_HOST = 'https://ollama.com';

/**
 * Agent Loop 실행 옵션
 */
export interface AgentLoopOptions {
    /** 사용할 모델 이름 */
    model?: string;
    /** 초기 메시지 목록 */
    messages: ChatMessage[];
    /** 사용 가능한 도구 정의 */
    tools: ToolDefinition[];
    /** 도구 이름 -> 실행 함수 매핑 */
    availableFunctions: Record<string, (...args: any[]) => any | Promise<any>>;
    /** Thinking 모드 활성화 */
    think?: ThinkOption;
    /** 스트리밍 모드 */
    stream?: boolean;
    /** 토큰 콜백 (스트리밍 시) */
    onToken?: (token: string, thinking?: string) => void;
    /** 도구 호출 콜백 */
    onToolCall?: (name: string, args: unknown, result: unknown) => void;
    /** 최대 반복 횟수 (무한 루프 방지) */
    maxIterations?: number;
}

/**
 * Agent Loop 결과
 */
export interface AgentLoopResult {
    /** 최종 응답 메시지 */
    message: ChatMessage;
    /** 전체 대화 히스토리 */
    history: ChatMessage[];
    /** 호출된 도구 목록 */
    toolCallsExecuted: Array<{
        name: string;
        arguments: unknown;
        result: unknown;
    }>;
    /** 사용량 메트릭 */
    metrics?: UsageMetrics;
    /** 반복 횟수 */
    iterations: number;
}

/**
 * ChatMessage를 Ollama Message 형식으로 변환
 */
function toOllamaMessage(msg: ChatMessage): Message {
    const ollamaMsg: Message = {
        role: msg.role as 'system' | 'user' | 'assistant' | 'tool',
        content: msg.content
    };

    if (msg.images) {
        ollamaMsg.images = msg.images as string[];
    }

    if (msg.tool_calls) {
        ollamaMsg.tool_calls = msg.tool_calls.map(tc => ({
            function: {
                name: tc.function.name,
                arguments: tc.function.arguments
            }
        }));
    }

    return ollamaMsg;
}

/**
 * Ollama Message를 ChatMessage 형식으로 변환
 */
function fromOllamaMessage(msg: Message): ChatMessage {
    const chatMsg: ChatMessage = {
        role: msg.role as 'system' | 'user' | 'assistant' | 'tool',
        content: msg.content
    };

    if (msg.images) {
        chatMsg.images = msg.images as string[];
    }

    if (msg.tool_calls && msg.tool_calls.length > 0) {
        chatMsg.tool_calls = msg.tool_calls.map((tc, index) => ({
            type: 'function' as const,
            function: {
                index,
                name: tc.function.name,
                arguments: tc.function.arguments as Record<string, unknown>
            }
        }));
    }

    return chatMsg;
}

/**
 * ToolDefinition을 Ollama Tool 형식으로 변환
 */
function toOllamaTool(tool: ToolDefinition): Tool {
    return {
        type: 'function',
        function: {
            name: tool.function.name,
            description: tool.function.description,
            parameters: tool.function.parameters
        }
    };
}

/**
 * Ollama 클라이언트 생성 (Cloud 지원)
 */
function createOllamaClient(model: string): Ollama {
    const apiKeyManager = getApiKeyManager();
    const isCloud = model?.toLowerCase().endsWith(':cloud');

    const host = isCloud ? OLLAMA_CLOUD_HOST : envConfig.ollamaBaseUrl;

    const ollama = new Ollama({
        host,
        headers: apiKeyManager.getAuthHeaders()
    });

    console.log(`[AgentLoop] 🌐 Ollama 클라이언트 생성 - 호스트: ${host}, 모델: ${model}`);

    return ollama;
}

/**
 * Multi-turn Tool Calling Agent Loop 실행
 * 
 * 도구 호출이 없을 때까지 자동으로 대화를 이어갑니다.
 * 
 * @example
 * ```typescript
 * const result = await runAgentLoop({
 *   model: 'gemini-3-flash-preview:cloud',
 *   messages: [{ role: 'user', content: '서울 날씨 알려줘' }],
 *   tools: [weatherTool],
 *   availableFunctions: { get_weather: getWeather },
 *   onToolCall: (name, args, result) => console.log(`Tool ${name}: ${result}`)
 * });
 * ```
 */
export async function runAgentLoop(options: AgentLoopOptions): Promise<AgentLoopResult> {
    const {
        model = envConfig.ollamaDefaultModel,
        messages: initialMessages,
        tools,
        availableFunctions,
        think = true,
        stream = false,
        onToken,
        onToolCall,
        maxIterations = 10
    } = options;

    const ollama = createOllamaClient(model);
    const ollamaTools = tools.map(toOllamaTool);

    // 메시지 히스토리 복사
    const messages: Message[] = initialMessages.map(toOllamaMessage);
    const toolCallsExecuted: AgentLoopResult['toolCallsExecuted'] = [];
    let iterations = 0;
    let lastMetrics: UsageMetrics | undefined;

    console.log(`[AgentLoop] 🚀 Agent Loop 시작 - 모델: ${model}, 도구: ${tools.length}개`);

    while (iterations < maxIterations) {
        iterations++;
        console.log(`[AgentLoop] 📍 반복 ${iterations}/${maxIterations}`);

        let response: ChatResponse;

        if (stream && onToken) {
            // 스트리밍 모드
            let content = '';
            let thinking = '';
            let toolCalls: ToolCall[] = [];

            const streamResponse = await ollama.chat({
                model,
                messages,
                tools: ollamaTools,
                stream: true,
                options: {
                    // think 옵션은 model options가 아닌 별도로 처리
                }
            });

            for await (const chunk of streamResponse) {
                // Thinking 처리
                if ((chunk.message as any)?.thinking) {
                    thinking += (chunk.message as any).thinking;
                    onToken('', (chunk.message as any).thinking);
                }

                // Content 처리
                if (chunk.message?.content) {
                    content += chunk.message.content;
                    onToken(chunk.message.content);
                }

                // Tool calls 수집
                if (chunk.message?.tool_calls) {
                    toolCalls = chunk.message.tool_calls;
                }

                // 메트릭 수집
                if (chunk.done) {
                    lastMetrics = {
                        total_duration: chunk.total_duration,
                        load_duration: chunk.load_duration,
                        prompt_eval_count: chunk.prompt_eval_count,
                        prompt_eval_duration: chunk.prompt_eval_duration,
                        eval_count: chunk.eval_count,
                        eval_duration: chunk.eval_duration
                    };
                }
            }

            // 스트리밍 완료 후 응답 구성
            response = {
                model,
                created_at: new Date(),
                message: {
                    role: 'assistant',
                    content,
                    tool_calls: toolCalls.length > 0 ? toolCalls : undefined
                },
                done: true,
                done_reason: toolCalls.length > 0 ? 'tool_calls' : 'stop',
                total_duration: lastMetrics?.total_duration,
                load_duration: lastMetrics?.load_duration,
                prompt_eval_count: lastMetrics?.prompt_eval_count,
                prompt_eval_duration: lastMetrics?.prompt_eval_duration,
                eval_count: lastMetrics?.eval_count,
                eval_duration: lastMetrics?.eval_duration
            } as ChatResponse;

            if (thinking) {
                (response.message as any).thinking = thinking;
            }

        } else {
            // 비스트리밍 모드
            response = await ollama.chat({
                model,
                messages,
                tools: ollamaTools,
                stream: false
            });

            lastMetrics = {
                total_duration: response.total_duration,
                load_duration: response.load_duration,
                prompt_eval_count: response.prompt_eval_count,
                prompt_eval_duration: response.prompt_eval_duration,
                eval_count: response.eval_count,
                eval_duration: response.eval_duration
            };
        }

        // 응답 메시지를 히스토리에 추가
        messages.push(response.message);

        // Thinking 로그
        if ((response.message as any)?.thinking) {
            console.log(`[AgentLoop] 🧠 Thinking: ${(response.message as any).thinking.substring(0, 100)}...`);
        }

        // Content 로그
        if (response.message.content) {
            console.log(`[AgentLoop] 💬 Content: ${response.message.content.substring(0, 100)}...`);
        }

        // Tool calls 확인
        const responsToolCalls = response.message.tool_calls ?? [];

        if (responsToolCalls.length === 0) {
            // 도구 호출 없음 - 루프 종료
            console.log(`[AgentLoop] ✅ 도구 호출 없음 - 루프 종료`);
            break;
        }

        // 도구 호출 처리
        for (const toolCall of responsToolCalls) {
            const funcName = toolCall.function.name;
            const funcArgs = toolCall.function.arguments;

            console.log(`[AgentLoop] 🔧 도구 호출: ${funcName}(${JSON.stringify(funcArgs)})`);

            if (!(funcName in availableFunctions)) {
                console.warn(`[AgentLoop] ⚠️ 알 수 없는 도구: ${funcName}`);
                continue;
            }

            try {
                // 도구 실행
                const result = await availableFunctions[funcName](funcArgs);
                const resultStr = typeof result === 'string' ? result : JSON.stringify(result);

                console.log(`[AgentLoop] 📤 도구 결과: ${resultStr.substring(0, 100)}...`);

                // 콜백 호출
                if (onToolCall) {
                    onToolCall(funcName, funcArgs, result);
                }

                // 실행 기록 저장
                toolCallsExecuted.push({
                    name: funcName,
                    arguments: funcArgs,
                    result
                });

                // 도구 결과를 메시지에 추가
                messages.push({
                    role: 'tool',
                    content: resultStr
                });

            } catch (error: any) {
                console.error(`[AgentLoop] ❌ 도구 실행 오류: ${error.message}`);
                messages.push({
                    role: 'tool',
                    content: `Error: ${error.message}`
                });
            }
        }
    }

    if (iterations >= maxIterations) {
        console.warn(`[AgentLoop] ⚠️ 최대 반복 횟수(${maxIterations}) 도달`);
    }

    // 최종 결과 구성
    const lastMessage = messages[messages.length - 1];
    const history = messages.map(fromOllamaMessage);

    console.log(`[AgentLoop] 🏁 Agent Loop 완료 - 반복: ${iterations}, 도구 호출: ${toolCallsExecuted.length}개`);

    return {
        message: fromOllamaMessage(lastMessage),
        history,
        toolCallsExecuted,
        metrics: lastMetrics,
        iterations
    };
}

/**
 * 단일 도구 호출 실행 (Agent Loop 사용)
 * 
 * 단순한 단일 도구 호출 시나리오에 사용됩니다.
 */
export async function executeSingleToolCall(
    model: string,
    prompt: string,
    tools: ToolDefinition[],
    availableFunctions: Record<string, (...args: any[]) => any>,
    options?: {
        think?: ThinkOption;
        onToken?: (token: string, thinking?: string) => void;
    }
): Promise<AgentLoopResult> {
    return runAgentLoop({
        model,
        messages: [{ role: 'user', content: prompt }],
        tools,
        availableFunctions,
        think: options?.think,
        stream: !!options?.onToken,
        onToken: options?.onToken,
        maxIterations: 3  // 단일 호출이므로 적은 반복
    });
}

/**
 * MCP Tool을 Ollama Tool로 변환하는 어댑터
 */
export function mcpToolToOllamaTool(mcpTool: {
    tool: {
        name: string;
        description: string;
        inputSchema: any;
    };
}): ToolDefinition {
    return {
        type: 'function',
        function: {
            name: mcpTool.tool.name,
            description: mcpTool.tool.description,
            parameters: mcpTool.tool.inputSchema
        }
    };
}

/**
 * 여러 MCP Tools를 Ollama Tools로 변환
 */
export function mcpToolsToOllamaTools(mcpTools: Array<{
    tool: {
        name: string;
        description: string;
        inputSchema: any;
    };
}>): ToolDefinition[] {
    return mcpTools.map(mcpToolToOllamaTool);
}
