/**
 * ============================================================
 * External Provider — 추론만 온 턴 복구 테스트
 * ============================================================
 *
 * 회귀(2026-09-11): 로컬 thinking 턴이 본문 없이 깨진 추론만 내고 끝나자 스트림 파서가 그 추론을
 * 답변으로 승격해 `The user is "The user1. <tool_result> …` 가 답변으로 저장됐다.
 * 수정: 파서는 승격하지 않고 빈 본문을 돌려준다(llm/reasoning-only-recovery). 여기서는
 *   ① 빈 응답 방어(B)의 도구를 끈 재요청 1회가 정상 답변을 받는지
 *   ② 재요청도 추론만이면 빈 답변 대신 종전처럼 추론을 노출하는지(D, 최후 수단)
 * 를 고정한다.
 */

jest.mock('../utils/logger', () => ({
    createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
}));
jest.mock('../chat/prompt', () => ({
    getExternalProviderSystemGuards: () => '[GUARD]',
}));
jest.mock('../mcp/unified-client', () => ({
    getUnifiedMCPClient: () => ({
        executeToolWithContext: jest.fn().mockResolvedValue({ content: '검색 결과 텍스트', isError: false }),
    }),
}));
// env 파생 상수 고정 (jest .env 의존 테스트 방지): 턴 5, wall-clock 가드 off, 서브에이전트 도구 off
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

/** 2026-09-11 운영에서 답변으로 저장된 깨진 추론 원문 */
const GARBAGE_REASONING = 'The user is "The user1.\n<tool_result> 这个 is the2026-09-11:00 (</thinking>\n</functions>';

type Turn = { content: string; thinking?: string };

/** 턴마다 정해진 응답(본문·추론)을 돌려주는 fake 로컬 provider. 도구 호출은 하지 않는다. */
function makeResolved(turns: Turn[], calls: Array<{ hadTools: boolean }>) {
    let n = 0;
    return {
        providerId: 'local-llm',
        modelId: 'test-model',
        fullId: 'local-llm:test-model',
        provider: {
            getCapabilities: () => ({ vision: false, toolCalling: true }),
            streamChat: jest.fn().mockImplementation(async (opts: any, cbs: any) => {
                const turn = turns[Math.min(n, turns.length - 1)];
                n++;
                calls.push({ hadTools: Array.isArray(opts.tools) && opts.tools.length > 0 });
                if (turn.thinking) cbs?.onThinking?.(turn.thinking);
                if (turn.content) cbs?.onToken?.(turn.content);
                return {
                    content: turn.content,
                    ...(turn.thinking ? { thinking: turn.thinking } : {}),
                    toolCalls: [],
                    finishReason: 'stop',
                };
            }),
        },
    } as any;
}

const webSearchTool = {
    type: 'function' as const,
    function: { name: 'web_search', description: '웹 검색', parameters: { type: 'object', properties: {} } },
};

async function run(turns: Turn[]) {
    const calls: Array<{ hadTools: boolean }> = [];
    const streamed: string[] = [];
    const result = await streamFromExternalProvider(
        { currentUserContext: null, allowedTools: [webSearchTool] } as any,
        makeResolved(turns, calls),
        { message: 'ㅎㅇ', userId: 'guest', history: [] } as any,
        (token) => { if (token) streamed.push(token); },
        {},
    );
    return { result, calls, streamed: streamed.join('') };
}

describe('External Provider — 추론만 온 턴', () => {
    it('첫 턴이 추론만이면 도구를 끈 재요청 1회로 정상 답변을 받는다 — 깨진 추론은 답변에 없다', async () => {
        const answer = '안녕하세요! 무엇을 도와드릴까요?';
        const { result, calls, streamed } = await run([
            { content: '', thinking: GARBAGE_REASONING },
            { content: answer },
        ]);

        expect(calls.length).toBe(2);
        expect(calls[1].hadTools).toBe(false);
        expect(result).toBe(answer);
        expect(streamed).not.toContain('The user1');
    });

    it('재요청도 추론만이면 빈 답변 대신 추론을 답변으로 노출한다 (최후 수단 — 종전 동작)', async () => {
        const { result, calls, streamed } = await run([
            { content: '', thinking: '첫 번째 추론' },
            { content: '', thinking: '두 번째 추론' },
        ]);

        expect(calls.length).toBe(2);
        expect(result).toBe('두 번째 추론');
        expect(streamed).toContain('두 번째 추론');
    });

    it('정상 답변 턴에는 개입하지 않는다', async () => {
        const { result, calls } = await run([{ content: '바로 답합니다.', thinking: '짧은 추론' }]);

        expect(calls.length).toBe(1);
        expect(result).toBe('바로 답합니다.');
    });
});
