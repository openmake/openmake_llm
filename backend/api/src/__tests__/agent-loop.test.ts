/**
 * ============================================================
 * Agent Loop Unit Tests
 * ============================================================
 *
 * runAgentLoop(), executeSingleToolCall(), mcpToolToOllamaTool(),
 * mcpToolsToOllamaTools() 에 대한 단위 테스트입니다.
 *
 * - 기본 루프 동작 (도구 호출 없음 / 있음)
 * - 최대 반복 횟수 제한
 * - 에러 처리 (영구 오류, 429 재시도)
 * - 콜백 호출 검증
 * - MCP → Ollama Tool 변환 어댑터
 */

// ============================================
// Mock Setup (MUST be before imports)
// ============================================

const mockChat = jest.fn();

jest.mock('ollama', () => ({
    Ollama: jest.fn().mockImplementation(() => ({
        chat: mockChat,
    })),
}));

jest.mock('../config', () => ({
    getConfig: () => ({
        ollamaBaseUrl: 'http://localhost:11434',
        ollamaDefaultModel: 'test-model',
        ollamaTimeout: 120000,
        jwtSecret: 'test-secret',
        nodeEnv: 'test',
    }),
}));

jest.mock('../config/constants', () => ({
    OLLAMA_CLOUD_HOST: 'https://cloud.example.com',
}));

jest.mock('../utils/logger', () => ({
    createLogger: () => ({
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        debug: jest.fn(),
    }),
}));

jest.mock('../ollama/api-key-manager', () => ({
    getApiKeyManager: () => ({
        getAuthHeaders: () => ({ Authorization: 'Bearer test-key' }),
        getAuthHeadersForIndex: () => ({ Authorization: 'Bearer test-key' }),
        getNextAvailableKey: () => 0,
        getKeyByIndex: () => 'test-key',
        reportSuccess: jest.fn(),
        reportFailure: jest.fn(() => false),
    }),
}));

// ============================================
// Imports (after mocks)
// ============================================

import {
    runAgentLoop,
    executeSingleToolCall,
    mcpToolToOllamaTool,
    mcpToolsToOllamaTools,
    AgentLoopOptions,
} from '../ollama/agent-loop';
import type { ToolDefinition } from '../ollama/types';

/** 올바르게 타입된 테스트 도구 생성 헬퍼 */
function makeTool(name: string, description = ''): ToolDefinition {
    return {
        type: 'function',
        function: {
            name,
            description,
            parameters: { type: 'object', properties: {} },
        },
    };
}

// ============================================
// Test Helpers
// ============================================

/** 도구 호출 없는 정상 응답 생성 */
function makeAssistantResponse(content: string) {
    return {
        model: 'test-model',
        created_at: new Date(),
        message: { role: 'assistant', content, tool_calls: undefined },
        done: true,
        done_reason: 'stop',
    };
}

/** 도구 호출 포함 응답 생성 */
function makeToolCallResponse(toolName: string, args: Record<string, unknown>) {
    return {
        model: 'test-model',
        created_at: new Date(),
        message: {
            role: 'assistant',
            content: '',
            tool_calls: [
                {
                    function: {
                        name: toolName,
                        arguments: args,
                    },
                },
            ],
        },
        done: true,
        done_reason: 'tool_calls',
    };
}

/** HTTP 상태 코드를 가진 에러 생성 */
function makeHttpError(status: number, message = 'HTTP Error') {
    return Object.assign(new Error(message), { status });
}

/** 기본 AgentLoopOptions (최소 설정) */
function makeOptions(overrides: Partial<AgentLoopOptions> = {}): AgentLoopOptions {
    return {
        model: 'test-model',
        messages: [{ role: 'user', content: 'Hello' }],
        tools: [],
        availableFunctions: {},
        maxIterations: 5,
        ...overrides,
    };
}

// ============================================
// Tests
// ============================================

describe('Agent Loop', () => {
    beforeEach(() => {
        // mockChat의 once 큐만 초기화 (Ollama 생성자 mock 구현은 유지)
        mockChat.mockReset();
        jest.useRealTimers();
    });

    // ------------------------------------------
    // runAgentLoop - 기본 동작
    // ------------------------------------------

    describe('runAgentLoop - 기본 동작', () => {
        it('도구 호출 없는 경우 1회 반복 후 종료해야 한다', async () => {
            mockChat.mockResolvedValueOnce(makeAssistantResponse('안녕하세요!'));

            const result = await runAgentLoop(makeOptions());

            expect(result.iterations).toBe(1);
            expect(result.message.content).toBe('안녕하세요!');
            expect(result.toolCallsExecuted).toHaveLength(0);
            expect(result.history).toHaveLength(2); // user + assistant
        });

        it('결과에 history가 전체 대화 메시지를 포함해야 한다', async () => {
            mockChat.mockResolvedValueOnce(makeAssistantResponse('응답'));

            const result = await runAgentLoop(makeOptions({
                messages: [{ role: 'user', content: '질문' }],
            }));

            expect(result.history[0].role).toBe('user');
            expect(result.history[0].content).toBe('질문');
            expect(result.history[1].role).toBe('assistant');
            expect(result.history[1].content).toBe('응답');
        });

        it('단일 도구 호출 후 최종 응답을 반환해야 한다', async () => {
            const mockFn = jest.fn().mockResolvedValue('도구 결과');

            mockChat
                .mockResolvedValueOnce(makeToolCallResponse('my_tool', { key: 'value' }))
                .mockResolvedValueOnce(makeAssistantResponse('도구를 사용했습니다'));

            const result = await runAgentLoop(makeOptions({
                tools: [makeTool('my_tool', '테스트 도구')],
                availableFunctions: { my_tool: mockFn },
            }));

            expect(result.iterations).toBe(2);
            expect(mockFn).toHaveBeenCalledWith({ key: 'value' });
            expect(result.toolCallsExecuted).toHaveLength(1);
            expect(result.toolCallsExecuted[0].name).toBe('my_tool');
            expect(result.toolCallsExecuted[0].result).toBe('도구 결과');
            expect(result.message.content).toBe('도구를 사용했습니다');
        });

        it('연속 도구 호출이 여러 반복에 걸쳐 처리되어야 한다', async () => {
            const toolA = jest.fn().mockResolvedValue('A 결과');
            const toolB = jest.fn().mockResolvedValue('B 결과');

            mockChat
                .mockResolvedValueOnce(makeToolCallResponse('tool_a', {}))
                .mockResolvedValueOnce(makeToolCallResponse('tool_b', {}))
                .mockResolvedValueOnce(makeAssistantResponse('완료'));

            const result = await runAgentLoop(makeOptions({
                tools: [makeTool('tool_a'), makeTool('tool_b')],
                availableFunctions: { tool_a: toolA, tool_b: toolB },
            }));

            expect(result.iterations).toBe(3);
            expect(result.toolCallsExecuted).toHaveLength(2);
            expect(toolA).toHaveBeenCalledTimes(1);
            expect(toolB).toHaveBeenCalledTimes(1);
        });

        it('알 수 없는 도구는 건너뛰고 루프를 계속해야 한다', async () => {
            mockChat
                .mockResolvedValueOnce(makeToolCallResponse('unknown_tool', {}))
                .mockResolvedValueOnce(makeAssistantResponse('완료'));

            const result = await runAgentLoop(makeOptions({
                tools: [],
                availableFunctions: {},
            }));

            expect(result.toolCallsExecuted).toHaveLength(0);
            expect(result.message.content).toBe('완료');
        });

        it('도구 실행 오류 시 오류 메시지를 tool 역할 메시지로 추가해야 한다', async () => {
            const errorFn = jest.fn().mockRejectedValue(new Error('도구 실패'));

            mockChat
                .mockResolvedValueOnce(makeToolCallResponse('fail_tool', {}))
                .mockResolvedValueOnce(makeAssistantResponse('오류 처리됨'));

            const result = await runAgentLoop(makeOptions({
                tools: [makeTool('fail_tool')],
                availableFunctions: { fail_tool: errorFn },
            }));

            // 루프가 중단되지 않고 계속되어야 함
            expect(result.message.content).toBe('오류 처리됨');
            expect(result.toolCallsExecuted).toHaveLength(0); // 실패한 도구는 기록 안됨
        });
    });

    // ------------------------------------------
    // runAgentLoop - 최대 반복 횟수
    // ------------------------------------------

    describe('runAgentLoop - maxIterations 제한', () => {
        it('maxIterations 도달 시 루프를 강제 종료해야 한다', async () => {
            // 항상 도구 호출 응답 반환 (무한 루프 상황)
            const alwaysToolCall = makeToolCallResponse('endless_tool', {});
            const toolFn = jest.fn().mockResolvedValue('결과');

            for (let i = 0; i < 4; i++) {
                mockChat.mockResolvedValueOnce(alwaysToolCall);
            }
            // 마지막 (maxIterations = 3)에는 일반 응답
            mockChat.mockResolvedValueOnce(makeAssistantResponse('강제 종료'));

            const result = await runAgentLoop(makeOptions({
                maxIterations: 3,
                tools: [makeTool('endless_tool')],
                availableFunctions: { endless_tool: toolFn },
            }));

            expect(result.iterations).toBe(3);
        });
    });

    // ------------------------------------------
    // runAgentLoop - 에러 처리
    // ------------------------------------------

    describe('runAgentLoop - 에러 처리', () => {
        it('401 에러는 즉시 throw해야 한다', async () => {
            mockChat.mockRejectedValueOnce(makeHttpError(401, 'Unauthorized'));

            await expect(runAgentLoop(makeOptions())).rejects.toThrow('Unauthorized');
            expect(mockChat).toHaveBeenCalledTimes(1);
        });

        it('403 에러는 즉시 throw해야 한다', async () => {
            mockChat.mockRejectedValueOnce(makeHttpError(403, 'Forbidden'));

            await expect(runAgentLoop(makeOptions())).rejects.toThrow('Forbidden');
            expect(mockChat).toHaveBeenCalledTimes(1);
        });

        it('404 에러는 즉시 throw해야 한다', async () => {
            mockChat.mockRejectedValueOnce(makeHttpError(404, 'Not Found'));

            await expect(runAgentLoop(makeOptions())).rejects.toThrow('Not Found');
            expect(mockChat).toHaveBeenCalledTimes(1);
        });

        it('KeyExhaustion 에러는 즉시 throw해야 한다', async () => {
            const keyError = Object.assign(new Error('API key exhausted'), { name: 'KeyExhaustionError' });
            mockChat.mockRejectedValueOnce(keyError);

            await expect(runAgentLoop(makeOptions())).rejects.toThrow('API key exhausted');
            expect(mockChat).toHaveBeenCalledTimes(1);
        });

        it('429 에러는 maxIterations까지 재시도 후 throw해야 한다', async () => {
            jest.useFakeTimers();
            const retryError = makeHttpError(429, 'Rate Limited');
            mockChat.mockRejectedValue(retryError);
            const promise = runAgentLoop(makeOptions({ maxIterations: 2 }));

            // rejection handler를 미리 붙여서 unhandled rejection 방지 후 타이머 실행
            const expectation = expect(promise).rejects.toThrow('Rate Limited');
            await jest.runAllTimersAsync();
            await expectation;
        });

        it('429 에러 후 성공하면 결과를 반환해야 한다', async () => {
            jest.useFakeTimers();
            const retryError = makeHttpError(429, 'Rate Limited');
            const successResponse = makeAssistantResponse('재시도 성공');

            mockChat
                .mockRejectedValueOnce(retryError)
                .mockResolvedValueOnce(successResponse);

            const promise = runAgentLoop(makeOptions({ maxIterations: 3 }));

            await jest.runAllTimersAsync();
            const result = await promise;

            expect(result.message.content).toBe('재시도 성공');
            expect(mockChat).toHaveBeenCalledTimes(2);
        });
    });

    // ------------------------------------------
    // runAgentLoop - 콜백 검증
    // ------------------------------------------

    describe('runAgentLoop - 콜백', () => {
        it('onToolCall 콜백이 도구 이름/인자/결과와 함께 호출되어야 한다', async () => {
            const onToolCall = jest.fn();
            const toolFn = jest.fn().mockResolvedValue('결과값');

            mockChat
                .mockResolvedValueOnce(makeToolCallResponse('cb_tool', { x: 1 }))
                .mockResolvedValueOnce(makeAssistantResponse('완료'));

            await runAgentLoop(makeOptions({
                tools: [makeTool('cb_tool')],
                availableFunctions: { cb_tool: toolFn },
                onToolCall,
            }));

            expect(onToolCall).toHaveBeenCalledTimes(1);
            expect(onToolCall).toHaveBeenCalledWith('cb_tool', { x: 1 }, '결과값');
        });

        it('onToolCall 없이도 정상 실행되어야 한다', async () => {
            const toolFn = jest.fn().mockResolvedValue('결과');

            mockChat
                .mockResolvedValueOnce(makeToolCallResponse('tool', {}))
                .mockResolvedValueOnce(makeAssistantResponse('완료'));

            await expect(runAgentLoop(makeOptions({
                tools: [makeTool('tool')],
                availableFunctions: { tool: toolFn },
            }))).resolves.toBeDefined();
        });
    });

    // ------------------------------------------
    // runAgentLoop - 결과 구조
    // ------------------------------------------

    describe('runAgentLoop - 결과 구조', () => {
        it('결과에 iterations 카운트가 포함되어야 한다', async () => {
            mockChat.mockResolvedValueOnce(makeAssistantResponse('응답'));

            const result = await runAgentLoop(makeOptions());

            expect(result).toHaveProperty('iterations');
            expect(result).toHaveProperty('message');
            expect(result).toHaveProperty('history');
            expect(result).toHaveProperty('toolCallsExecuted');
        });

        it('toolCallsExecuted에 name/arguments/result가 포함되어야 한다', async () => {
            const toolFn = jest.fn().mockResolvedValue({ data: 'value' });

            mockChat
                .mockResolvedValueOnce(makeToolCallResponse('info_tool', { query: 'test' }))
                .mockResolvedValueOnce(makeAssistantResponse('완료'));

            const result = await runAgentLoop(makeOptions({
                tools: [makeTool('info_tool')],
                availableFunctions: { info_tool: toolFn },
            }));

            expect(result.toolCallsExecuted[0]).toMatchObject({
                name: 'info_tool',
                arguments: { query: 'test' },
                result: { data: 'value' },
            });
        });

        it('Cloud 모델(:cloud 접미사)도 정상 처리되어야 한다', async () => {
            mockChat.mockResolvedValueOnce(makeAssistantResponse('클라우드 응답'));

            const result = await runAgentLoop(makeOptions({
                model: 'gemini-3-flash-preview:cloud',
            }));

            expect(result.message.content).toBe('클라우드 응답');
        });
    });

    // ------------------------------------------
    // executeSingleToolCall
    // ------------------------------------------

    describe('executeSingleToolCall', () => {
        it('runAgentLoop를 올바른 인자로 호출해야 한다', async () => {
            mockChat.mockResolvedValueOnce(makeAssistantResponse('단일 호출 응답'));

            const toolFn = jest.fn().mockResolvedValue('single result');
            const tools = [makeTool('single_tool')];

            const result = await executeSingleToolCall(
                'test-model',
                '프롬프트',
                tools,
                { single_tool: toolFn }
            );

            expect(result).toHaveProperty('message');
            expect(mockChat).toHaveBeenCalledTimes(1);
        });

        it('maxIterations가 3으로 제한되어야 한다 (단일 호출 특성)', async () => {
            // 항상 도구 호출 → maxIterations=3 확인
            const alwaysToolCall = makeToolCallResponse('t', {});
            for (let i = 0; i < 4; i++) {
                mockChat.mockResolvedValueOnce(alwaysToolCall);
            }
            mockChat.mockResolvedValueOnce(makeAssistantResponse('종료'));

            const result = await executeSingleToolCall(
                'test-model',
                '프롬프트',
                [makeTool('t')],
                { t: jest.fn().mockResolvedValue('r') }
            );

            expect(result.iterations).toBeLessThanOrEqual(3);
        });
    });

    // ------------------------------------------
    // mcpToolToOllamaTool
    // ------------------------------------------

    describe('mcpToolToOllamaTool', () => {
        it('MCP 도구 형식을 Ollama ToolDefinition으로 올바르게 변환해야 한다', () => {
            const mcpTool = {
                tool: {
                    name: 'web_search',
                    description: '웹 검색 도구',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            query: { type: 'string', description: '검색어' },
                        },
                        required: ['query'],
                    },
                },
            };

            const result = mcpToolToOllamaTool(mcpTool);

            expect(result.type).toBe('function');
            expect(result.function.name).toBe('web_search');
            expect(result.function.description).toBe('웹 검색 도구');
            expect(result.function.parameters).toEqual(mcpTool.tool.inputSchema);
        });

        it('빈 파라미터 스키마도 올바르게 변환해야 한다', () => {
            const mcpTool = {
                tool: {
                    name: 'no_params_tool',
                    description: '파라미터 없는 도구',
                    inputSchema: { type: 'object', properties: {} },
                },
            };

            const result = mcpToolToOllamaTool(mcpTool);

            expect(result.function.name).toBe('no_params_tool');
            expect(result.function.parameters).toEqual({ type: 'object', properties: {} });
        });
    });

    // ------------------------------------------
    // mcpToolsToOllamaTools
    // ------------------------------------------

    describe('mcpToolsToOllamaTools', () => {
        it('MCP 도구 배열을 Ollama ToolDefinition 배열로 변환해야 한다', () => {
            const mcpTools = [
                { tool: { name: 'tool_a', description: 'A', inputSchema: { type: 'object', properties: {} } } },
                { tool: { name: 'tool_b', description: 'B', inputSchema: { type: 'object', properties: {} } } },
                { tool: { name: 'tool_c', description: 'C', inputSchema: { type: 'object', properties: {} } } },
            ];

            const result = mcpToolsToOllamaTools(mcpTools);

            expect(result).toHaveLength(3);
            expect(result[0].function.name).toBe('tool_a');
            expect(result[1].function.name).toBe('tool_b');
            expect(result[2].function.name).toBe('tool_c');
        });

        it('빈 배열에 대해 빈 배열을 반환해야 한다', () => {
            expect(mcpToolsToOllamaTools([])).toEqual([]);
        });
    });
});
