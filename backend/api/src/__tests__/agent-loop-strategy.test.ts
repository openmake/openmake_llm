/**
 * ============================================================
 * AgentLoopStrategy Unit Tests
 * ============================================================
 *
 * Multi-turn 도구 호출 루프 전략(AgentLoopStrategy)에 대한 단위 테스트입니다.
 * DirectStrategy는 생성자 주입이므로 mock 교체가 용이합니다.
 *
 * 검증 항목:
 * - 도구 호출 없음 → 단일 턴으로 즉시 응답 반환
 * - 도구 호출 있음 → 도구 실행 후 루프 계속, 최종 응답 반환
 * - maxTurns 도달 시 마지막 응답으로 루프 종료
 * - checkAborted() 매 턴 호출
 * - 사용자 티어 기반 도구 접근 거부 (canUseTool=false)
 * - web_search 내장 도구 처리
 * - web_fetch 내장 도구 처리
 * - 미지원 도구 → ToolRouter.executeTool 위임
 * - 도구 실행 에러 전파 (Error: 접두사)
 * - metrics 누적
 * - supportsTools=false 시 도구 목록 비전달
 * - 도구 실행 결과를 tool 역할 메시지로 히스토리에 추가
 */

// ============================================
// Mock Setup (MUST be before imports)
// ============================================

jest.mock('../utils/logger', () => ({
    createLogger: () => ({
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        debug: jest.fn(),
    }),
}));

const mockCanUseTool = jest.fn();
jest.mock('../mcp/tool-tiers', () => ({
    canUseTool: mockCanUseTool,
}));

const mockExecuteTool = jest.fn();
const mockGetToolRouter = jest.fn().mockReturnValue({
    executeTool: mockExecuteTool,
});
const mockGetUnifiedMCPClient = jest.fn().mockReturnValue({
    getToolRouter: mockGetToolRouter,
});
jest.mock('../mcp/unified-client', () => ({
    getUnifiedMCPClient: mockGetUnifiedMCPClient,
}));

// ============================================
// Imports (after mocks)
// ============================================

import { AgentLoopStrategy } from '../services/chat-strategies/agent-loop-strategy';
import type { DirectStrategy } from '../services/chat-strategies/direct-strategy';
import type { AgentLoopStrategyContext } from '../services/chat-strategies/types';
import type { DirectStrategyResult } from '../services/chat-strategies/types';
import type { OllamaClient } from '../ollama/client';
import type { UserContext } from '../mcp/user-sandbox';

// ============================================
// Helpers
// ============================================

const mockDirectExecute = jest.fn();
const mockDirectStrategy = {
    execute: mockDirectExecute,
} as unknown as DirectStrategy;

function makeUserContext(tier: 'free' | 'pro' | 'enterprise' = 'enterprise'): UserContext {
    return {
        userId: 'test-user',
        tier,
        role: 'user',
    };
}

function makeClient(): OllamaClient {
    return {
        chat: jest.fn(),
        webSearch: jest.fn(),
        webFetch: jest.fn(),
        model: 'test-model',
    } as unknown as OllamaClient;
}

function makeContext(overrides: Partial<AgentLoopStrategyContext> = {}): AgentLoopStrategyContext {
    return {
        client: makeClient(),
        currentHistory: [{ role: 'user', content: 'Hello' }],
        chatOptions: {},
        maxTurns: 5,
        supportsTools: true,
        supportsThinking: false,
        thinkingMode: false,
        thinkingLevel: undefined,
        executionPlan: undefined,
        currentUserContext: makeUserContext(),
        getAllowedTools: jest.fn().mockReturnValue([]),
        onToken: jest.fn(),
        abortSignal: undefined,
        checkAborted: undefined,
        ...overrides,
    };
}

/** 도구 호출 없는 DirectStrategy 응답 */
function makeDirectResult(response: string, metrics?: Record<string, unknown>): DirectStrategyResult {
    return {
        response,
        assistantMessage: { role: 'assistant', content: response },
        toolCalls: [],
        metrics,
    };
}

/** 도구 호출 포함 DirectStrategy 응답 */
function makeDirectResultWithTools(toolName: string, args: Record<string, unknown> = {}): DirectStrategyResult {
    return {
        response: '',
        assistantMessage: {
            role: 'assistant',
            content: '',
            tool_calls: [{ type: 'function', function: { name: toolName, arguments: args } }],
        },
        toolCalls: [{ type: 'function', function: { name: toolName, arguments: args } }],
        metrics: undefined,
    };
}

// ============================================
// Tests
// ============================================

describe('AgentLoopStrategy', () => {
    let strategy: AgentLoopStrategy;

    beforeEach(() => {
        strategy = new AgentLoopStrategy(mockDirectStrategy);
        mockDirectExecute.mockReset();
        mockCanUseTool.mockReset();
        mockExecuteTool.mockReset();
        // 기본적으로 도구 접근 허용
        mockCanUseTool.mockReturnValue(true);
    });

    // ------------------------------------------
    // 기본 동작: 도구 호출 없음
    // ------------------------------------------

    describe('도구 호출 없음 (단일 턴 종료)', () => {
        it('즉시 응답을 반환하고 succeeded 없이 ChatResult를 반환한다', async () => {
            mockDirectExecute.mockResolvedValueOnce(makeDirectResult('Hello, world!'));

            const ctx = makeContext();
            const result = await strategy.execute(ctx);

            expect(result.response).toBe('Hello, world!');
        });

        it('DirectStrategy.execute()를 정확히 1번 호출한다', async () => {
            mockDirectExecute.mockResolvedValueOnce(makeDirectResult('Done'));

            await strategy.execute(makeContext());

            expect(mockDirectExecute).toHaveBeenCalledTimes(1);
        });

        it('assistantMessage를 currentHistory에 추가한다', async () => {
            const ctx = makeContext();
            mockDirectExecute.mockResolvedValueOnce(makeDirectResult('Response'));

            await strategy.execute(ctx);

            const lastMsg = ctx.currentHistory[ctx.currentHistory.length - 1];
            expect(lastMsg.role).toBe('assistant');
            expect(lastMsg.content).toBe('Response');
        });

        it('metrics가 있으면 결과에 포함된다', async () => {
            const metrics = { eval_count: 50, eval_duration: 1200 };
            mockDirectExecute.mockResolvedValueOnce(makeDirectResult('Done', metrics));

            const result = await strategy.execute(makeContext());

            expect(result.metrics).toEqual(metrics);
        });

        it('빈 응답도 그대로 반환한다', async () => {
            mockDirectExecute.mockResolvedValueOnce(makeDirectResult(''));

            const result = await strategy.execute(makeContext());

            expect(result.response).toBe('');
        });
    });

    // ------------------------------------------
    // 도구 호출 후 최종 응답
    // ------------------------------------------

    describe('도구 호출 후 최종 응답', () => {
        it('도구 결과 전달 후 2번째 턴에서 최종 응답을 반환한다', async () => {
            mockDirectExecute
                .mockResolvedValueOnce(makeDirectResultWithTools('some_tool', { arg: 'value' }))
                .mockResolvedValueOnce(makeDirectResult('Final answer'));
            mockExecuteTool.mockResolvedValueOnce({
                isError: false,
                content: [{ text: 'tool result' }],
            });

            const ctx = makeContext();
            const result = await strategy.execute(ctx);

            expect(result.response).toBe('Final answer');
            expect(mockDirectExecute).toHaveBeenCalledTimes(2);
        });

        it('도구 실행 결과를 tool 역할 메시지로 히스토리에 추가한다', async () => {
            mockDirectExecute
                .mockResolvedValueOnce(makeDirectResultWithTools('search_tool', {}))
                .mockResolvedValueOnce(makeDirectResult('Final'));
            mockExecuteTool.mockResolvedValueOnce({
                isError: false,
                content: [{ text: 'search result' }],
            });

            const ctx = makeContext();
            await strategy.execute(ctx);

            const toolMsg = ctx.currentHistory.find((m) => m.role === 'tool');
            expect(toolMsg).toBeDefined();
            expect(toolMsg?.content).toBe('search result');
            expect(toolMsg?.tool_name).toBe('search_tool');
        });

        it('여러 도구 호출이 있으면 모두 처리한다', async () => {
            const multiToolResult: DirectStrategyResult = {
                response: '',
                assistantMessage: {
                    role: 'assistant',
                    content: '',
                    tool_calls: [
                        { type: 'function', function: { name: 'tool_a', arguments: {} } },
                        { type: 'function', function: { name: 'tool_b', arguments: {} } },
                    ],
                },
                toolCalls: [
                    { type: 'function', function: { name: 'tool_a', arguments: {} } },
                    { type: 'function', function: { name: 'tool_b', arguments: {} } },
                ],
            };

            mockDirectExecute
                .mockResolvedValueOnce(multiToolResult)
                .mockResolvedValueOnce(makeDirectResult('Done'));
            mockExecuteTool
                .mockResolvedValueOnce({ isError: false, content: [{ text: 'result_a' }] })
                .mockResolvedValueOnce({ isError: false, content: [{ text: 'result_b' }] });

            const ctx = makeContext();
            await strategy.execute(ctx);

            // tool 역할 메시지 2개 존재해야 함
            const toolMsgs = ctx.currentHistory.filter((m) => m.role === 'tool');
            expect(toolMsgs).toHaveLength(2);
        });
    });

    // ------------------------------------------
    // maxTurns 제한
    // ------------------------------------------

    describe('maxTurns 제한', () => {
        it('maxTurns에 도달하면 루프를 종료한다', async () => {
            // 항상 도구 호출 반환 → maxTurns에 도달
            mockDirectExecute.mockResolvedValue(makeDirectResultWithTools('looping_tool', {}));
            mockExecuteTool.mockResolvedValue({ isError: false, content: [{ text: 'ok' }] });

            const ctx = makeContext({ maxTurns: 3 });
            const result = await strategy.execute(ctx);

            expect(mockDirectExecute).toHaveBeenCalledTimes(3);
            // maxTurns 후 finalResponse는 빈 문자열 (마지막 턴이 도구 호출로 끝났으므로)
            expect(result.response).toBe('');
        });

        it('maxTurns=1이면 첫 번째 턴에서만 실행한다', async () => {
            mockDirectExecute.mockResolvedValueOnce(makeDirectResult('Only once'));

            const ctx = makeContext({ maxTurns: 1 });
            await strategy.execute(ctx);

            expect(mockDirectExecute).toHaveBeenCalledTimes(1);
        });
    });

    // ------------------------------------------
    // checkAborted
    // ------------------------------------------

    describe('checkAborted 호출', () => {
        it('매 턴 시작 시 checkAborted()를 호출한다', async () => {
            mockDirectExecute.mockResolvedValueOnce(makeDirectResult('Done'));

            const checkAborted = jest.fn();
            const ctx = makeContext({ checkAborted });
            await strategy.execute(ctx);

            expect(checkAborted).toHaveBeenCalledTimes(1);
        });

        it('2턴 루프에서 checkAborted()가 2번 호출된다', async () => {
            mockDirectExecute
                .mockResolvedValueOnce(makeDirectResultWithTools('tool', {}))
                .mockResolvedValueOnce(makeDirectResult('Done'));
            mockExecuteTool.mockResolvedValueOnce({ isError: false, content: [{ text: 'ok' }] });

            const checkAborted = jest.fn();
            const ctx = makeContext({ checkAborted });
            await strategy.execute(ctx);

            expect(checkAborted).toHaveBeenCalledTimes(2);
        });

        it('checkAborted가 undefined이면 에러 없이 진행된다', async () => {
            mockDirectExecute.mockResolvedValueOnce(makeDirectResult('Done'));

            const ctx = makeContext({ checkAborted: undefined });
            await expect(strategy.execute(ctx)).resolves.toBeDefined();
        });
    });

    // ------------------------------------------
    // supportsTools=false
    // ------------------------------------------

    describe('supportsTools=false', () => {
        it('supportsTools=false이면 getAllowedTools()를 호출하지 않는다', async () => {
            mockDirectExecute.mockResolvedValueOnce(makeDirectResult('Done'));

            const getAllowedTools = jest.fn().mockReturnValue([]);
            const ctx = makeContext({ supportsTools: false, getAllowedTools });
            await strategy.execute(ctx);

            expect(getAllowedTools).not.toHaveBeenCalled();
        });

        it('supportsTools=false이면 allowedTools=[]로 DirectStrategy에 전달한다', async () => {
            mockDirectExecute.mockResolvedValueOnce(makeDirectResult('Done'));

            const ctx = makeContext({ supportsTools: false });
            await strategy.execute(ctx);

            const callArg = mockDirectExecute.mock.calls[0][0];
            expect(callArg.allowedTools).toEqual([]);
        });
    });

    // ------------------------------------------
    // 도구 접근 권한 거부 (canUseTool=false)
    // ------------------------------------------

    describe('도구 접근 권한 거부', () => {
        it('canUseTool=false이면 권한 없음 메시지를 tool 결과로 히스토리에 추가한다', async () => {
            mockCanUseTool.mockReturnValue(false);
            mockDirectExecute
                .mockResolvedValueOnce(makeDirectResultWithTools('premium_tool', {}))
                .mockResolvedValueOnce(makeDirectResult('Final'));

            const ctx = makeContext({
                currentUserContext: makeUserContext('free'),
            });
            await strategy.execute(ctx);

            const toolMsg = ctx.currentHistory.find((m) => m.role === 'tool');
            expect(toolMsg).toBeDefined();
            expect(toolMsg?.content).toContain('권한 없음');
        });

        it('canUseTool=false이면 ToolRouter.executeTool을 호출하지 않는다', async () => {
            mockCanUseTool.mockReturnValue(false);
            mockDirectExecute
                .mockResolvedValueOnce(makeDirectResultWithTools('locked_tool', {}))
                .mockResolvedValueOnce(makeDirectResult('Final'));

            await strategy.execute(makeContext({ currentUserContext: makeUserContext('free') }));

            expect(mockExecuteTool).not.toHaveBeenCalled();
        });

        it('currentUserContext=null이면 권한 체크를 건너뛴다', async () => {
            mockDirectExecute
                .mockResolvedValueOnce(makeDirectResultWithTools('any_tool', {}))
                .mockResolvedValueOnce(makeDirectResult('Done'));
            mockExecuteTool.mockResolvedValueOnce({ isError: false, content: [{ text: 'ok' }] });

            const ctx = makeContext({ currentUserContext: null });
            await strategy.execute(ctx);

            // canUseTool은 호출되지 않아야 함
            expect(mockCanUseTool).not.toHaveBeenCalled();
            // ToolRouter는 호출되어야 함
            expect(mockExecuteTool).toHaveBeenCalledTimes(1);
        });
    });

    // ------------------------------------------
    // 내장 도구: web_search
    // ------------------------------------------

    describe('web_search 내장 도구', () => {
        it('web_search 도구 호출 시 context.client.webSearch()를 실행한다', async () => {
            mockDirectExecute
                .mockResolvedValueOnce(makeDirectResultWithTools('web_search', { query: 'TypeScript tips', max_results: 3 }))
                .mockResolvedValueOnce(makeDirectResult('Final'));

            const client = makeClient();
            (client.webSearch as jest.Mock).mockResolvedValueOnce({
                results: [
                    { title: 'TS Guide', url: 'https://ts.dev', content: 'TypeScript basics' },
                ],
            });

            const ctx = makeContext({ client });
            await strategy.execute(ctx);

            expect(client.webSearch).toHaveBeenCalledWith('TypeScript tips', 3);
        });

        it('web_search 결과를 포맷팅하여 tool 메시지로 히스토리에 추가한다', async () => {
            mockDirectExecute
                .mockResolvedValueOnce(makeDirectResultWithTools('web_search', { query: 'test', max_results: 2 }))
                .mockResolvedValueOnce(makeDirectResult('Done'));

            const client = makeClient();
            (client.webSearch as jest.Mock).mockResolvedValueOnce({
                results: [
                    { title: 'Result 1', url: 'https://r1.com', content: 'content1' },
                ],
            });

            const ctx = makeContext({ client });
            await strategy.execute(ctx);

            const toolMsg = ctx.currentHistory.find((m) => m.role === 'tool');
            expect(toolMsg?.content).toContain('웹 검색 결과');
            expect(toolMsg?.content).toContain('Result 1');
        });

        it('web_search 결과가 없으면 "검색 결과가 없습니다" 반환', async () => {
            mockDirectExecute
                .mockResolvedValueOnce(makeDirectResultWithTools('web_search', { query: 'nothing' }))
                .mockResolvedValueOnce(makeDirectResult('Done'));

            const client = makeClient();
            (client.webSearch as jest.Mock).mockResolvedValueOnce({ results: [] });

            const ctx = makeContext({ client });
            await strategy.execute(ctx);

            const toolMsg = ctx.currentHistory.find((m) => m.role === 'tool');
            expect(toolMsg?.content).toBe('검색 결과가 없습니다.');
        });

        it('web_search 에러 시 Error: 접두사 메시지를 반환한다', async () => {
            mockDirectExecute
                .mockResolvedValueOnce(makeDirectResultWithTools('web_search', { query: 'fail' }))
                .mockResolvedValueOnce(makeDirectResult('Done'));

            const client = makeClient();
            (client.webSearch as jest.Mock).mockRejectedValueOnce(new Error('Search API down'));

            const ctx = makeContext({ client });
            await strategy.execute(ctx);

            const toolMsg = ctx.currentHistory.find((m) => m.role === 'tool');
            expect(toolMsg?.content).toContain('Error:');
            expect(toolMsg?.content).toContain('Search API down');
        });
    });

    // ------------------------------------------
    // 내장 도구: web_fetch
    // ------------------------------------------

    describe('web_fetch 내장 도구', () => {
        it('web_fetch 도구 호출 시 context.client.webFetch()를 실행한다', async () => {
            mockDirectExecute
                .mockResolvedValueOnce(makeDirectResultWithTools('web_fetch', { url: 'https://example.com' }))
                .mockResolvedValueOnce(makeDirectResult('Done'));

            const client = makeClient();
            (client.webFetch as jest.Mock).mockResolvedValueOnce({
                title: 'Example Page',
                content: 'Page content here',
            });

            const ctx = makeContext({ client });
            await strategy.execute(ctx);

            expect(client.webFetch).toHaveBeenCalledWith('https://example.com');
        });

        it('web_fetch 결과를 포맷팅하여 tool 메시지로 추가한다', async () => {
            mockDirectExecute
                .mockResolvedValueOnce(makeDirectResultWithTools('web_fetch', { url: 'https://example.com' }))
                .mockResolvedValueOnce(makeDirectResult('Done'));

            const client = makeClient();
            (client.webFetch as jest.Mock).mockResolvedValueOnce({
                title: 'Example Page',
                content: 'Fetched page content',
            });

            const ctx = makeContext({ client });
            await strategy.execute(ctx);

            const toolMsg = ctx.currentHistory.find((m) => m.role === 'tool');
            expect(toolMsg?.content).toContain('웹페이지');
            expect(toolMsg?.content).toContain('Example Page');
            expect(toolMsg?.content).toContain('Fetched page content');
        });

        it('web_fetch 에러 시 Error: 접두사 메시지를 반환한다', async () => {
            mockDirectExecute
                .mockResolvedValueOnce(makeDirectResultWithTools('web_fetch', { url: 'https://bad.url' }))
                .mockResolvedValueOnce(makeDirectResult('Done'));

            const client = makeClient();
            (client.webFetch as jest.Mock).mockRejectedValueOnce(new Error('Fetch failed'));

            const ctx = makeContext({ client });
            await strategy.execute(ctx);

            const toolMsg = ctx.currentHistory.find((m) => m.role === 'tool');
            expect(toolMsg?.content).toContain('Error:');
        });
    });

    // ------------------------------------------
    // ToolRouter 위임 (미지원 도구)
    // ------------------------------------------

    describe('ToolRouter 위임', () => {
        it('알 수 없는 도구는 ToolRouter.executeTool()에 위임한다', async () => {
            mockDirectExecute
                .mockResolvedValueOnce(makeDirectResultWithTools('custom_mcp_tool', { param: 'value' }))
                .mockResolvedValueOnce(makeDirectResult('Done'));
            mockExecuteTool.mockResolvedValueOnce({
                isError: false,
                content: [{ text: 'MCP result' }],
            });

            const ctx = makeContext();
            await strategy.execute(ctx);

            expect(mockExecuteTool).toHaveBeenCalledWith(
                'custom_mcp_tool',
                { param: 'value' },
                expect.any(Object) // userContext
            );
        });

        it('ToolRouter 결과를 tool 메시지로 히스토리에 추가한다', async () => {
            mockDirectExecute
                .mockResolvedValueOnce(makeDirectResultWithTools('my_tool', {}))
                .mockResolvedValueOnce(makeDirectResult('Done'));
            mockExecuteTool.mockResolvedValueOnce({
                isError: false,
                content: [{ text: 'Tool output line 1' }, { text: 'Tool output line 2' }],
            });

            const ctx = makeContext();
            await strategy.execute(ctx);

            const toolMsg = ctx.currentHistory.find((m) => m.role === 'tool');
            expect(toolMsg?.content).toContain('Tool output line 1');
            expect(toolMsg?.content).toContain('Tool output line 2');
        });

        it('ToolRouter isError=true이면 Error 접두사 메시지 반환', async () => {
            mockDirectExecute
                .mockResolvedValueOnce(makeDirectResultWithTools('broken_tool', {}))
                .mockResolvedValueOnce(makeDirectResult('Done'));
            mockExecuteTool.mockResolvedValueOnce({
                isError: true,
                content: [{ text: 'Something went wrong' }],
            });

            const ctx = makeContext();
            await strategy.execute(ctx);

            const toolMsg = ctx.currentHistory.find((m) => m.role === 'tool');
            expect(toolMsg?.content).toContain('Error executing tool');
            expect(toolMsg?.content).toContain('Something went wrong');
        });

        it('ToolRouter throw 시 Error: 접두사 메시지 반환', async () => {
            mockDirectExecute
                .mockResolvedValueOnce(makeDirectResultWithTools('exception_tool', {}))
                .mockResolvedValueOnce(makeDirectResult('Done'));
            mockExecuteTool.mockRejectedValueOnce(new Error('MCP connection lost'));

            const ctx = makeContext();
            await strategy.execute(ctx);

            const toolMsg = ctx.currentHistory.find((m) => m.role === 'tool');
            expect(toolMsg?.content).toContain('Error:');
            expect(toolMsg?.content).toContain('MCP connection lost');
        });
    });

    // ------------------------------------------
    // thinkOption 전달
    // ------------------------------------------

    describe('thinkOption 전달', () => {
        it('executionPlan.thinkingLevel이 있으면 DirectStrategy에 전달한다', async () => {
            mockDirectExecute.mockResolvedValueOnce(makeDirectResult('Done'));

            const ctx = makeContext({
                supportsThinking: true,
                executionPlan: { thinkingLevel: 'high' } as any,
            });
            await strategy.execute(ctx);

            const callArg = mockDirectExecute.mock.calls[0][0];
            expect(callArg.thinkOption).toBe('high');
        });

        it('thinkingMode=true이면 thinkingLevel을 DirectStrategy에 전달한다', async () => {
            mockDirectExecute.mockResolvedValueOnce(makeDirectResult('Done'));

            const ctx = makeContext({
                supportsThinking: true,
                thinkingMode: true,
                thinkingLevel: 'medium',
                executionPlan: undefined,
            });
            await strategy.execute(ctx);

            const callArg = mockDirectExecute.mock.calls[0][0];
            expect(callArg.thinkOption).toBe('medium');
        });

        it('supportsThinking=false이면 thinkOption=undefined로 전달한다', async () => {
            mockDirectExecute.mockResolvedValueOnce(makeDirectResult('Done'));

            const ctx = makeContext({
                supportsThinking: false,
                thinkingMode: true,
                thinkingLevel: 'high',
            });
            await strategy.execute(ctx);

            const callArg = mockDirectExecute.mock.calls[0][0];
            expect(callArg.thinkOption).toBeUndefined();
        });
    });
});
