/**
 * ============================================================
 * DirectStrategy Unit Tests
 * ============================================================
 *
 * 단일 LLM 직접 호출 전략(DirectStrategy)에 대한 단위 테스트입니다.
 *
 * 검증 항목:
 * - 기본 응답 반환 (content, assistantMessage, toolCalls, metrics)
 * - 도구 호출 포함된 응답 처리
 * - tool_calls 토큰 스트리밍 필터링
 * - 빈 응답 처리 (content undefined → '')
 * - 메트릭 없는 응답 처리
 * - thinkOption 전달 검증
 * - allowedTools 비어있을 때 undefined 전달
 * - OllamaClient 에러 전파
 */

// ============================================
// Mock Setup (MUST be before imports)
// ============================================

const mockClientChat = jest.fn();

jest.mock('../utils/logger', () => ({
    createLogger: () => ({
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        debug: jest.fn(),
    }),
}));

// ============================================
// Imports
// ============================================

import { DirectStrategy } from '../domains/chat/strategies/direct-strategy';
import type { DirectStrategyContext } from '../domains/chat/strategies/types';
import type { OllamaClient } from '../ollama/client';
import type { ToolDefinition, ToolCall, ChatMessage } from '../ollama/types';

// ============================================
// Helpers
// ============================================

/**
 * OllamaClient의 chat 메서드만 mock한 stub 클라이언트를 생성합니다.
 */
function makeClient(): OllamaClient {
    return {
        chat: mockClientChat,
    } as unknown as OllamaClient;
}

/**
 * 최소한의 DirectStrategyContext를 생성합니다.
 */
function makeContext(overrides: Partial<DirectStrategyContext> = {}): DirectStrategyContext {
    return {
        client: makeClient(),
        currentHistory: [{ role: 'user', content: 'Hello' }],
        chatOptions: {},
        allowedTools: [],
        thinkOption: undefined,
        onToken: jest.fn(),
        ...overrides,
    };
}

/**
 * 기본 성공 응답 객체를 생성합니다.
 */
function makeResponse(overrides: Partial<{
    content: string;
    tool_calls: ToolCall[];
    metrics: Record<string, unknown>;
}> = {}) {
    return {
        content: 'Test response',
        tool_calls: undefined,
        metrics: { eval_count: 10, eval_duration: 500 },
        ...overrides,
    };
}

// ============================================
// Tests
// ============================================

describe('DirectStrategy', () => {
    let strategy: DirectStrategy;

    beforeEach(() => {
        strategy = new DirectStrategy();
        mockClientChat.mockReset();
    });

    // ------------------------------------------
    // 기본 동작
    // ------------------------------------------

    describe('기본 응답 반환', () => {
        it('content가 있는 응답을 올바르게 반환한다', async () => {
            const response = makeResponse({ content: '안녕하세요!' });
            mockClientChat.mockResolvedValueOnce(response);

            const ctx = makeContext();
            const result = await strategy.execute(ctx);

            expect(result.response).toBe('안녕하세요!');
        });

        it('assistantMessage에 role=assistant와 content가 포함된다', async () => {
            mockClientChat.mockResolvedValueOnce(makeResponse({ content: 'Hi' }));

            const result = await strategy.execute(makeContext());

            expect(result.assistantMessage.role).toBe('assistant');
            expect(result.assistantMessage.content).toBe('Hi');
        });

        it('tool_calls 없는 응답 시 toolCalls가 빈 배열이다', async () => {
            mockClientChat.mockResolvedValueOnce(makeResponse({ tool_calls: undefined }));

            const result = await strategy.execute(makeContext());

            expect(result.toolCalls).toEqual([]);
        });

        it('metrics가 존재하면 복사해서 반환한다', async () => {
            const metrics = { eval_count: 42, eval_duration: 1234 };
            mockClientChat.mockResolvedValueOnce(makeResponse({ metrics }));

            const result = await strategy.execute(makeContext());

            expect(result.metrics).toEqual(metrics);
            // 원본 객체와 다른 참조여야 함 (defensive copy)
            expect(result.metrics).not.toBe(metrics);
        });

        it('metrics가 없으면 undefined를 반환한다', async () => {
            mockClientChat.mockResolvedValueOnce({
                content: 'Response',
                tool_calls: undefined,
                // metrics 필드 없음
            });

            const result = await strategy.execute(makeContext());

            expect(result.metrics).toBeUndefined();
        });
    });

    // ------------------------------------------
    // 빈 / null content 처리
    // ------------------------------------------

    describe('빈 content 처리', () => {
        it('content가 undefined이면 response와 assistantMessage.content가 빈 문자열이다', async () => {
            mockClientChat.mockResolvedValueOnce({
                content: undefined,
                tool_calls: undefined,
            });

            const result = await strategy.execute(makeContext());

            expect(result.response).toBe('');
            expect(result.assistantMessage.content).toBe('');
        });

        it('content가 빈 문자열이면 그대로 반환한다', async () => {
            mockClientChat.mockResolvedValueOnce({
                content: '',
                tool_calls: undefined,
            });

            const result = await strategy.execute(makeContext());

            expect(result.response).toBe('');
        });
    });

    // ------------------------------------------
    // 도구 호출 처리
    // ------------------------------------------

    describe('도구 호출(ToolCall) 처리', () => {
        it('tool_calls가 있으면 toolCalls에 포함된다', async () => {
            const toolCalls: ToolCall[] = [
                { type: 'function', function: { name: 'search', arguments: { query: 'test' } } },
            ];
            mockClientChat.mockResolvedValueOnce(makeResponse({ tool_calls: toolCalls }));

            const result = await strategy.execute(makeContext());

            expect(result.toolCalls).toHaveLength(1);
            expect(result.toolCalls[0].function.name).toBe('search');
        });

        it('assistantMessage.tool_calls에도 동일한 tool_calls가 설정된다', async () => {
            const toolCalls: ToolCall[] = [
                { type: 'function', function: { name: 'calculate', arguments: { expr: '1+1' } } },
            ];
            mockClientChat.mockResolvedValueOnce(makeResponse({ tool_calls: toolCalls }));

            const result = await strategy.execute(makeContext());

            expect(result.assistantMessage.tool_calls).toEqual(toolCalls);
        });

        it('여러 개의 tool_calls를 모두 반환한다', async () => {
            const toolCalls: ToolCall[] = [
                { type: 'function', function: { name: 'search', arguments: {} } },
                { type: 'function', function: { name: 'fetch', arguments: { url: 'https://example.com' } } },
            ];
            mockClientChat.mockResolvedValueOnce(makeResponse({ tool_calls: toolCalls }));

            const result = await strategy.execute(makeContext());

            expect(result.toolCalls).toHaveLength(2);
        });
    });

    // ------------------------------------------
    // 도구 목록 전달
    // ------------------------------------------

    describe('allowedTools 전달', () => {
        it('allowedTools가 비어있으면 chat()에 tools=undefined로 전달한다', async () => {
            mockClientChat.mockResolvedValueOnce(makeResponse());

            const ctx = makeContext({ allowedTools: [] });
            await strategy.execute(ctx);

            // 4번째 인자(extraOptions)의 tools 필드 확인
            const callArgs = mockClientChat.mock.calls[0];
            expect(callArgs[3]).toEqual(expect.objectContaining({ tools: undefined }));
        });

        it('allowedTools가 있으면 chat()에 tools로 전달한다', async () => {
            mockClientChat.mockResolvedValueOnce(makeResponse());

            const tool: ToolDefinition = {
                type: 'function',
                function: {
                    name: 'search',
                    description: 'Search the web',
                    parameters: {
                        type: 'object',
                        properties: { query: { type: 'string' } },
                        required: ['query'],
                    },
                },
            };

            const ctx = makeContext({ allowedTools: [tool] });
            await strategy.execute(ctx);

            const callArgs = mockClientChat.mock.calls[0];
            expect(callArgs[3]).toEqual(expect.objectContaining({ tools: [tool] }));
        });
    });

    // ------------------------------------------
    // thinkOption 전달
    // ------------------------------------------

    describe('thinkOption 전달', () => {
        it('thinkOption이 undefined이면 chat()에 think=undefined로 전달한다', async () => {
            mockClientChat.mockResolvedValueOnce(makeResponse());

            const ctx = makeContext({ thinkOption: undefined });
            await strategy.execute(ctx);

            const callArgs = mockClientChat.mock.calls[0];
            expect(callArgs[3]).toEqual(expect.objectContaining({ think: undefined }));
        });

        it('thinkOption=high이면 chat()에 think="high"로 전달한다', async () => {
            mockClientChat.mockResolvedValueOnce(makeResponse());

            const ctx = makeContext({ thinkOption: 'high' });
            await strategy.execute(ctx);

            const callArgs = mockClientChat.mock.calls[0];
            expect(callArgs[3]).toEqual(expect.objectContaining({ think: 'high' }));
        });

        it('thinkOption=low이면 chat()에 think="low"로 전달한다', async () => {
            mockClientChat.mockResolvedValueOnce(makeResponse());

            const ctx = makeContext({ thinkOption: 'low' });
            await strategy.execute(ctx);

            const callArgs = mockClientChat.mock.calls[0];
            expect(callArgs[3]).toEqual(expect.objectContaining({ think: 'low' }));
        });
    });

    // ------------------------------------------
    // 스트리밍 토큰 필터링
    // ------------------------------------------

    describe('스트리밍 토큰 필터링', () => {
        it('일반 토큰은 onToken 콜백으로 전달한다', async () => {
            mockClientChat.mockImplementationOnce(async (_history, _opts, onToken) => {
                onToken('Hello');
                onToken(' world');
                return makeResponse({ content: 'Hello world' });
            });

            const onToken = jest.fn();
            const ctx = makeContext({ onToken });
            await strategy.execute(ctx);

            expect(onToken).toHaveBeenCalledWith('Hello');
            expect(onToken).toHaveBeenCalledWith(' world');
            expect(onToken).toHaveBeenCalledTimes(2);
        });

        it('"tool_calls"이 포함된 토큰은 onToken 콜백을 호출하지 않는다', async () => {
            mockClientChat.mockImplementationOnce(async (_history, _opts, onToken) => {
                onToken('Normal token');
                onToken('{"tool_calls":[{"function":{"name":"search"}}]}');
                onToken('Another normal token');
                return makeResponse({ content: 'Normal token Another normal token' });
            });

            const onToken = jest.fn();
            const ctx = makeContext({ onToken });
            await strategy.execute(ctx);

            // tool_calls 포함 토큰은 제외
            expect(onToken).toHaveBeenCalledWith('Normal token');
            expect(onToken).toHaveBeenCalledWith('Another normal token');
            expect(onToken).not.toHaveBeenCalledWith(expect.stringContaining('tool_calls'));
            expect(onToken).toHaveBeenCalledTimes(2);
        });

        it('"tool_calls" 텍스트가 없는 모든 토큰이 전달된다', async () => {
            const tokens = ['I ', 'can ', 'help ', 'you!'];
            mockClientChat.mockImplementationOnce(async (_history, _opts, onToken) => {
                tokens.forEach((t) => onToken(t));
                return makeResponse({ content: tokens.join('') });
            });

            const onToken = jest.fn();
            await strategy.execute(makeContext({ onToken }));

            expect(onToken).toHaveBeenCalledTimes(tokens.length);
        });
    });

    // ------------------------------------------
    // 히스토리 및 옵션 전달
    // ------------------------------------------

    describe('인수 전달 검증', () => {
        it('currentHistory를 첫 번째 인수로 chat()에 전달한다', async () => {
            mockClientChat.mockResolvedValueOnce(makeResponse());

            const history: ChatMessage[] = [
                { role: 'system', content: 'You are helpful' },
                { role: 'user', content: 'What is 2+2?' },
            ];
            const ctx = makeContext({ currentHistory: history });
            await strategy.execute(ctx);

            expect(mockClientChat.mock.calls[0][0]).toBe(history);
        });

        it('chatOptions를 두 번째 인수로 chat()에 전달한다', async () => {
            mockClientChat.mockResolvedValueOnce(makeResponse());

            const chatOptions = { temperature: 0.7, top_p: 0.9 };
            const ctx = makeContext({ chatOptions });
            await strategy.execute(ctx);

            expect(mockClientChat.mock.calls[0][1]).toBe(chatOptions);
        });
    });

    // ------------------------------------------
    // 에러 전파
    // ------------------------------------------

    describe('에러 전파', () => {
        it('OllamaClient.chat()이 throw하면 에러를 그대로 전파한다', async () => {
            const error = new Error('Network timeout');
            mockClientChat.mockRejectedValueOnce(error);

            await expect(strategy.execute(makeContext())).rejects.toThrow('Network timeout');
        });

        it('429 에러도 그대로 전파한다', async () => {
            const rateLimitError = new Error('Rate limit exceeded');
            (rateLimitError as NodeJS.ErrnoException).code = '429';
            mockClientChat.mockRejectedValueOnce(rateLimitError);

            await expect(strategy.execute(makeContext())).rejects.toThrow('Rate limit exceeded');
        });
    });
});
