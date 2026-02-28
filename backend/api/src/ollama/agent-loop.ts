/**
 * ============================================================
 * Agent Loop - Multi-turn Tool Calling 에이전트 루프
 * ============================================================
 *
 * Ollama Tool Calling API를 활용한 다중 턴 에이전트 루프입니다.
 * LLM이 도구 호출을 요청하면 자동으로 실행하고 결과를 다시 전달하는 사이클을 반복합니다.
 *
 * @module ollama/agent-loop
 * @description
 * - Multi-turn 도구 호출 루프: LLM -> 도구 호출 -> 결과 전달 -> LLM 반복
 * - 스트리밍 지원 (SSE를 통한 실시간 토큰 전달)
 * - Thinking(추론 과정) 표시 지원 (Ollama Native Thinking)
 * - 무한 루프 방지 (maxIterations 제한, 기본값: 10)
 * - 에러 내성: 429 에러 시 지수 백오프 재시도, 영구 에러(401/403/404) 시 즉시 중단
 * - MCP Tool -> Ollama Tool 변환 어댑터 제공
 *
 * @description 루프 실행 플로우:
 * 1. 초기 메시지 목록 + 도구 정의를 LLM에 전송
 * 2. LLM 응답에 tool_calls가 포함되면:
 *    a. 각 tool_call의 함수를 availableFunctions에서 찾아 실행
 *    b. 실행 결과를 tool 역할 메시지로 히스토리에 추가
 *    c. 다시 LLM에 전송 (2단계 반복)
 * 3. 종료 조건:
 *    - tool_calls가 없는 응답 수신 (정상 종료)
 *    - maxIterations 도달 (강제 종료)
 *    - 영구 에러 발생 (401/403/404/KeyExhaustion)
 *
 * @see https://docs.ollama.com/capabilities/tool-calling#multi-turn-tool-calling-agent-loop
 */

import { Ollama, Message, Tool, ToolCall, ChatResponse } from 'ollama';
import { ChatMessage, ToolDefinition, ThinkOption, UsageMetrics, normalizeThinkOption } from './types';
import { createLogger } from '../utils/logger';

/**
 * Thinking 필드를 포함하는 확장 메시지 인터페이스
 *
 * Ollama Native Thinking 기능 사용 시 메시지에 thinking 필드가 추가됩니다.
 *
 * @interface MessageWithThinking
 * @extends Message
 */
interface MessageWithThinking extends Message {
    /** 추론 과정 텍스트 (Ollama Native Thinking) */
    thinking?: string;
}
import { getApiKeyManager } from './api-key-manager';
import { getConfig } from '../config';
import { OLLAMA_CLOUD_HOST } from '../config/constants';

const envConfig = getConfig();
const logger = createLogger('AgentLoop');

/**
 * 도구 실행 함수 타입 — 파싱된 인자를 받아 결과를 반환합니다.
 * @type ToolFunction
 */
type ToolFunction = (args: Record<string, unknown>) => unknown | Promise<unknown>;

// Ollama Cloud 호스트: constants.ts에서 중앙 관리 (OLLAMA_CLOUD_HOST)

/**
 * 다양한 에러 객체 형식에서 HTTP 상태 코드를 추출하기 위한 타입
 *
 * Ollama SDK, Axios, 기타 HTTP 라이브러리가 서로 다른 에러 형식을 사용하므로
 * 여러 가능한 필드를 모두 포함합니다.
 *
 * @type OllamaLikeError
 */
type OllamaLikeError = {
    /** HTTP 상태 코드 (직접 필드) */
    status?: number;
    /** HTTP 상태 코드 (camelCase 필드) */
    statusCode?: number;
    /** HTTP 상태 코드 (snake_case 필드) */
    status_code?: number;
    /** 응답 객체의 상태 코드 */
    response?: { status?: number };
    /** 에러 객체의 상태 코드 */
    error?: { status?: number };
    /** 에러 메시지 */
    message?: string;
    /** 에러 이름 (예: 'KeyExhaustionError') */
    name?: string;
};

/**
 * 다양한 에러 객체 형식에서 HTTP 상태 코드를 추출합니다.
 *
 * status, statusCode, status_code, response.status, error.status 순으로 탐색합니다.
 *
 * @param error - 에러 객체 (unknown 타입)
 * @returns HTTP 상태 코드 또는 undefined (추출 불가 시)
 */
function getHttpStatus(error: unknown): number | undefined {
    if (!error || typeof error !== 'object') return undefined;
    const err = error as OllamaLikeError;
    return err.status ?? err.statusCode ?? err.status_code ?? err.response?.status ?? err.error?.status;
}

/**
 * 에러가 API 키 소진(KeyExhaustion) 에러인지 판별합니다.
 *
 * 에러 이름/메시지에서 'keyexhaustion' 또는 'api key' + 'exhaust' 패턴을 검색합니다.
 *
 * @param error - 에러 객체 (unknown 타입)
 * @returns API 키 소진 에러 여부
 */
function isApiKeyExhaustionError(error: unknown): boolean {
    if (!error || typeof error !== 'object') return false;
    const err = error as OllamaLikeError;
    const text = `${err.name || ''} ${err.message || ''}`.toLowerCase();
    return text.includes('keyexhaustion') || text.includes('api key') && text.includes('exhaust');
}

/**
 * 지정된 시간(밀리초)만큼 대기합니다.
 *
 * @param ms - 대기 시간 (밀리초)
 * @returns 대기 완료 Promise
 */
function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Agent Loop 실행 옵션
 *
 * runAgentLoop() 함수에 전달하는 설정 객체입니다.
 * 모델, 메시지, 도구, 콜백, 반복 제한 등을 포함합니다.
 *
 * @interface AgentLoopOptions
 */
export interface AgentLoopOptions {
    /** 사용할 모델 이름 */
    model?: string;
    /** 초기 메시지 목록 */
    messages: ChatMessage[];
    /** 사용 가능한 도구 정의 */
    tools: ToolDefinition[];
    /** 도구 이름 -> 실행 함수 매핑 */
    availableFunctions: Record<string, ToolFunction>;
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
 * Agent Loop 실행 결과
 *
 * 최종 응답 메시지, 전체 대화 히스토리, 실행된 도구 호출 기록,
 * 성능 메트릭, 반복 횟수를 포함합니다.
 *
 * @interface AgentLoopResult
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
 * 프로젝트 내부의 ChatMessage를 Ollama SDK의 Message 형식으로 변환합니다.
 *
 * images, tool_calls 필드가 있으면 Ollama 형식에 맞게 매핑합니다.
 *
 * @param msg - 변환할 ChatMessage 객체
 * @returns Ollama SDK Message 객체
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
 * Ollama SDK의 Message를 프로젝트 내부 ChatMessage 형식으로 변환합니다.
 *
 * images, tool_calls 필드가 있으면 프로젝트 내부 형식에 맞게 매핑합니다.
 * tool_calls의 arguments는 Record<string, unknown>으로 타입 단언합니다.
 *
 * @param msg - 변환할 Ollama Message 객체
 * @returns 프로젝트 내부 ChatMessage 객체
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
 * 프로젝트 내부의 ToolDefinition을 Ollama SDK의 Tool 형식으로 변환합니다.
 *
 * @param tool - 변환할 ToolDefinition 객체
 * @returns Ollama SDK Tool 객체
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
 * Ollama SDK 클라이언트 인스턴스를 생성합니다 (Cloud/Local 자동 감지).
 *
 * 모델 이름이 ':cloud' 접미사를 가지면 Ollama Cloud 호스트를 사용하고,
 * 그렇지 않으면 로컬 Ollama 서버를 사용합니다.
 * 키풀에서 라운드로빈으로 다음 사용 가능한 키를 할당합니다.
 *
 * @param model - 모델 이름 (`:cloud` 접미사로 Cloud/Local 판별)
 * @returns 설정된 Ollama SDK 클라이언트 인스턴스
 */
function createOllamaClient(model: string): Ollama {
    const apiKeyManager = getApiKeyManager();
    const lowerModel = model?.toLowerCase() ?? '';
    const isCloud = lowerModel.endsWith(':cloud') || lowerModel.endsWith('-cloud');

    const host = isCloud ? OLLAMA_CLOUD_HOST : envConfig.ollamaBaseUrl;

    // 키풀에서 라운드로빈으로 다음 가용 키 할당 (모델 무관)
    const keyIndex = apiKeyManager.getNextAvailableKey();
    const headers = keyIndex !== -1
        ? apiKeyManager.getAuthHeadersForIndex(keyIndex)
        : apiKeyManager.getAuthHeaders();

    const ollama = new Ollama({
        host,
        headers
    });

    logger.info(`🌐 Ollama 클라이언트 생성 - 호스트: ${host}, 모델: ${model}, Key: ${keyIndex !== -1 ? keyIndex + 1 : 'default'}`);

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
        think: rawThink = true,
        stream = false,
        onToken,
        onToolCall,
        maxIterations = 10
    } = options;

    // GPT-OSS 모델은 think: true/false를 무시함 → 문자열 레벨로 자동 변환
    // @see https://docs.ollama.com/capabilities/thinking
    const think = normalizeThinkOption(rawThink, model);

    const ollama = createOllamaClient(model);
    const ollamaTools = tools.map(toOllamaTool);

    // 메시지 히스토리 복사
    const messages: Message[] = initialMessages.map(toOllamaMessage);
    const toolCallsExecuted: AgentLoopResult['toolCallsExecuted'] = [];
    let iterations = 0;
    let lastMetrics: UsageMetrics | undefined;

    logger.info(`🚀 Agent Loop 시작 - 모델: ${model}, 도구: ${tools.length}개`);

    while (iterations < maxIterations) {
        iterations++;
        logger.info(`📍 반복 ${iterations}/${maxIterations}`);

        let response: ChatResponse;
        let requestAttempt = 0;

        while (true) {
            try {
                if (stream && onToken) {
                    let content = '';
                    let thinking = '';
                    let toolCalls: ToolCall[] = [];

                    const streamResponse = await ollama.chat({
                        model,
                        messages,
                        tools: ollamaTools,
                        stream: true,
                        think,
                        options: {
                        }
                    });

                    for await (const chunk of streamResponse) {
                        if ((chunk.message as MessageWithThinking)?.thinking) {
                            thinking += (chunk.message as MessageWithThinking).thinking;
                            onToken('', (chunk.message as MessageWithThinking).thinking!);
                        }

                        if (chunk.message?.content) {
                            content += chunk.message.content;
                            onToken(chunk.message.content);
                        }

                        if (chunk.message?.tool_calls) {
                            // 스트리밍 시 tool_calls 누적 (Ollama 공식: 청크별 누적 필요)
                            toolCalls = [...toolCalls, ...chunk.message.tool_calls];
                        }

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
                        (response.message as MessageWithThinking).thinking = thinking;
                    }
                } else {
                    response = await ollama.chat({
                        model,
                        messages,
                        tools: ollamaTools,
                        stream: false,
                        think
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

                break;
            } catch (error: unknown) {
                const status = getHttpStatus(error);
                const isPermanent = status === 401 || status === 403 || status === 404 || isApiKeyExhaustionError(error);

                 if (isPermanent) {
                     logger.error(`❌ 영구 실패(${status || 'unknown'}): ${(error instanceof Error ? error.message : String(error))}`);
                     throw error;
                 }

                requestAttempt++;
                if (requestAttempt >= maxIterations) {
                    throw error;
                }

                if (status === 429) {
                    const backoffMs = Math.min(1000 * Math.pow(2, requestAttempt - 1), 10000);
                    logger.warn(`⚠️ 429 응답 - ${backoffMs}ms 후 재시도 (${requestAttempt}/${maxIterations - 1})`);
                    await sleep(backoffMs);
                 } else {
                     logger.warn(`⚠️ 요청 실패(${status || 'unknown'}) - 재시도 (${requestAttempt}/${maxIterations - 1})`);
                 }
            }
        }

        // 응답 메시지를 히스토리에 추가
        messages.push(response.message);

        // Thinking 로그
         if ((response.message as MessageWithThinking)?.thinking) {
             logger.info(`🧠 Thinking: ${(response.message as MessageWithThinking).thinking!.substring(0, 100)}...`);
         }

        // Content 로그
         if (response.message.content) {
             logger.info(`💬 Content: ${response.message.content.substring(0, 100)}...`);
         }

        // Tool calls 확인
        const responsToolCalls = response.message.tool_calls ?? [];

         if (responsToolCalls.length === 0) {
             // 도구 호출 없음 - 루프 종료
             logger.info(`✅ 도구 호출 없음 - 루프 종료`);
             break;
         }

        // 도구 호출 처리
        for (const toolCall of responsToolCalls) {
            const funcName = toolCall.function.name;
            const funcArgs = toolCall.function.arguments;

             logger.info(`🔧 도구 호출: ${funcName}(${JSON.stringify(funcArgs)})`);

             if (!(funcName in availableFunctions)) {
                 logger.warn(`⚠️ 알 수 없는 도구: ${funcName}`);
                 continue;
             }

            try {
                // 도구 실행
                const result = await availableFunctions[funcName](funcArgs);
                const resultStr = typeof result === 'string' ? result : JSON.stringify(result);

                 logger.info(`📤 도구 결과: ${resultStr.substring(0, 100)}...`);

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

                // 도구 결과를 메시지에 추가 (Ollama 공식 스펙: tool_name 필수)
                messages.push({
                    role: 'tool',
                    content: resultStr,
                    tool_name: funcName
                });

             } catch (error: unknown) {
                 logger.error(`❌ 도구 실행 오류: ${(error instanceof Error ? error.message : String(error))}`);
                 messages.push({
                    role: 'tool',
                    content: `Error: ${(error instanceof Error ? error.message : String(error))}`,
                    tool_name: funcName
                });
            }
        }
    }

     if (iterations >= maxIterations) {
         logger.warn(`⚠️ 최대 반복 횟수(${maxIterations}) 도달`);
     }

    // 최종 결과 구성
    const lastMessage = messages[messages.length - 1];
    const history = messages.map(fromOllamaMessage);

    logger.info(`🏁 Agent Loop 완료 - 반복: ${iterations}, 도구 호출: ${toolCallsExecuted.length}개`);

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
    availableFunctions: Record<string, ToolFunction>,
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
        inputSchema: Record<string, unknown>;
    };
}): ToolDefinition {
    return {
        type: 'function',
        function: {
            name: mcpTool.tool.name,
            description: mcpTool.tool.description,
            parameters: mcpTool.tool.inputSchema as ToolDefinition['function']['parameters']
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
        inputSchema: Record<string, unknown>;
    };
}>): ToolDefinition[] {
    return mcpTools.map(mcpToolToOllamaTool);
}
