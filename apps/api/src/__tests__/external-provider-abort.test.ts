/**
 * ============================================================
 * External Provider — 클라이언트 중단 뒤 루프 계속 진행 차단 테스트
 * ============================================================
 *
 * 회귀(2026-10-14 운영): Discord 봇이 300초 제한으로 요청을 끊어 abortSignal 이 발화했는데,
 * 잘린 스트림의 깨진 도구 호출({} 인자)을 실제로 실행하고 LLM 을 한 번 더 호출했다.
 * 수정: LLM 호출 직후·턴 경계에서 abortSignal 을 확인해 도구 실행·추가 턴·정상 완료 없이
 * 'ABORTED' 를 던진다(기존 관례).
 */

const mockExecuteTool = jest.fn();
const mockRecordUsage = jest.fn();

jest.mock('../utils/logger', () => ({
    createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
}));
jest.mock('../chat/prompt', () => ({
    getExternalProviderSystemGuards: () => '[GUARD]',
}));
jest.mock('../runtime-ports/tool-runtime', () => ({
    ...jest.requireActual('../runtime-ports/tool-runtime'),
    getToolRuntime: () => ({
        listLLMTools: jest.fn().mockResolvedValue([
            { type: 'function', function: { name: 'web_search', description: '', parameters: {} } },
        ]),
        listTools: jest.fn().mockResolvedValue([]),
        executeTool: mockExecuteTool,
        getUserToolGroups: () => [],
        normalizeToolCall: (name: string, args: Record<string, unknown>) => ({ name, args }),
        callUserServerTool: jest.fn().mockResolvedValue(null),
        runWithUserInputContext: (_c: unknown, fn: () => unknown) => fn(),
        ensureUserToolsForTask: jest.fn().mockResolvedValue(undefined),
        releaseUserToolsForTask: jest.fn().mockResolvedValue(undefined),
        onUserLogin: jest.fn(), onUserLogout: jest.fn(), onChatStart: jest.fn(), onChatEnd: jest.fn(),
        onServerReady: jest.fn(), shutdown: jest.fn(),
    }),
}));
// 사용량 기록 — 중단이 어떤 errorCode 로 남는지 확인한다(실제 DB 기록은 하지 않는다).
jest.mock('../services/chat-service/external-tool-exec', () => ({
    ...jest.requireActual('../services/chat-service/external-tool-exec'),
    recordExternalUsageFireAndForget: (...args: unknown[]) => mockRecordUsage(...args),
}));
// env 파생 상수 고정: 턴 5, wall-clock 가드 off, 서브에이전트·spawn off
jest.mock('../config/runtime-limits', () => {
    const actual = jest.requireActual('../config/runtime-limits');
    return {
        ...actual,
        AGENT_LOOP_LIMITS: { ...actual.AGENT_LOOP_LIMITS, MAX_TURNS: 5, MAX_WALL_CLOCK_MS: 0 },
        CHAT_SUBAGENT: { ...actual.CHAT_SUBAGENT, ENABLED: false },
        AGENT_SPAWN: { ...actual.AGENT_SPAWN, ENABLED: false },
    };
});

import { streamFromExternalProvider } from '../services/chat-service/external-fallback';

const webSearchTool = {
    type: 'function' as const,
    function: { name: 'web_search', description: '웹 검색', parameters: { type: 'object', properties: {} } },
};

/** 매 호출마다 web_search 도구 호출을 돌려주는 fake provider — onCall 에서 중단을 흉내낸다. */
function makeResolved(onCall: (n: number) => void) {
    let n = 0;
    const streamChat = jest.fn().mockImplementation(async () => {
        n++;
        onCall(n);
        return {
            content: '',
            toolCalls: [{ id: `t${n}`, name: 'web_search', args: {}, argumentsInvalid: true }],
            finishReason: 'tool_calls',
        };
    });
    return {
        streamChat,
        resolved: {
            providerId: 'local-llm',
            modelId: 'test-model',
            fullId: 'local-llm:test-model',
            provider: { getCapabilities: () => ({ vision: false, toolCalling: true }), streamChat },
        } as any,
    };
}

describe('External Provider — 클라이언트 중단', () => {
    beforeEach(() => {
        mockExecuteTool.mockReset();
        mockRecordUsage.mockReset();
        mockExecuteTool.mockResolvedValue({ content: [{ type: 'text', text: '결과' }] });
    });

    it('스트림 종료 시점에 abortSignal 이 aborted 면 도구를 실행하지 않고 ABORTED 를 던진다', async () => {
        const controller = new AbortController();
        // 도구 호출 인자를 스트리밍하던 중 클라이언트가 끊었다 — 스트림은 잘린 채 끝난다.
        const { streamChat, resolved } = makeResolved(() => controller.abort());

        await expect(streamFromExternalProvider(
            { currentUserContext: null, allowedTools: [webSearchTool] } as any,
            resolved,
            { message: '웹 검색해줘', userId: 'guest', history: [], abortSignal: controller.signal } as any,
            () => {},
            {},
        )).rejects.toThrow('ABORTED');

        expect(streamChat).toHaveBeenCalledTimes(1);
        expect(mockExecuteTool).not.toHaveBeenCalled();
    });

    it('도구 실행 중 중단되면 다음 턴 LLM 을 호출하지 않고 ABORTED 를 던진다', async () => {
        const controller = new AbortController();
        const { streamChat, resolved } = makeResolved(() => {});
        mockExecuteTool.mockImplementation(async () => {
            controller.abort();
            return { content: [{ type: 'text', text: '결과' }] };
        });

        await expect(streamFromExternalProvider(
            { currentUserContext: null, allowedTools: [webSearchTool] } as any,
            resolved,
            { message: '웹 검색해줘', userId: 'guest', history: [], abortSignal: controller.signal } as any,
            () => {},
            {},
        )).rejects.toThrow('ABORTED');

        expect(mockExecuteTool).toHaveBeenCalledTimes(1);
        expect(streamChat).toHaveBeenCalledTimes(1);
    });

    it('중단은 사용량 기록에 UPSTREAM_ERROR 가 아니라 CLIENT_ABORTED 로 남는다', async () => {
        const controller = new AbortController();
        const { resolved } = makeResolved(() => controller.abort());

        await expect(streamFromExternalProvider(
            { currentUserContext: null, allowedTools: [webSearchTool] } as any,
            resolved,
            { message: '웹 검색해줘', userId: 'guest', history: [], abortSignal: controller.signal } as any,
            () => {},
            {},
        )).rejects.toThrow('ABORTED');

        expect(mockRecordUsage).toHaveBeenCalledTimes(1);
        expect(mockRecordUsage.mock.calls[0][1]).toMatchObject({ errorCode: 'CLIENT_ABORTED' });
    });

    it('provider 가 중단을 ProviderError(UPSTREAM_ERROR)로 던져도 신호가 중단이면 CLIENT_ABORTED 다', async () => {
        const controller = new AbortController();
        const streamChat = jest.fn().mockImplementation(async () => {
            controller.abort();
            throw Object.assign(new Error('OpenAI 호환 호출 중단'), { code: 'UPSTREAM_ERROR' });
        });
        const resolved = {
            providerId: 'local-llm', modelId: 'test-model', fullId: 'local-llm:test-model',
            provider: { getCapabilities: () => ({ vision: false, toolCalling: true }), streamChat },
        } as any;

        await expect(streamFromExternalProvider(
            { currentUserContext: null, allowedTools: [webSearchTool] } as any,
            resolved,
            { message: '웹 검색해줘', userId: 'guest', history: [], abortSignal: controller.signal } as any,
            () => {},
            {},
        )).rejects.toThrow();

        expect(mockRecordUsage.mock.calls[0][1]).toMatchObject({ errorCode: 'CLIENT_ABORTED' });
    });
});
