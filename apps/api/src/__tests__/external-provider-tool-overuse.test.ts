/**
 * ============================================================
 * External Provider — 같은 도구 반복 사용 가드 (인자 무관)
 * ============================================================
 *
 * 회귀: doom-loop 가드는 "도구+인자" 해시 기준이라 검색어만 바꿔 부르면 걸리지 않았다.
 * 실측(2026-08-02): 검색성 질의 6건 중 3건이 쿼리를 갈아가며 최대 턴(5)을 소진했고
 * ("주식코드" → "엔비디아 주가" → "nvda stock price today" …) 매 턴 모델 prefill 이
 * 누적돼 총 37초가 걸렸다.
 *
 * 수정: 도구명별 누적 호출 수로 WARN(마무리 유도) / BREAK(도구 차단) 을 건다.
 */
jest.mock('../utils/logger', () => ({
    createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
}));
jest.mock('../chat/prompt', () => ({ getExternalProviderSystemGuards: () => '[GUARD]' }));
jest.mock('../mcp/unified-client', () => ({
    getUnifiedMCPClient: () => ({
        executeToolWithContext: jest.fn().mockResolvedValue({ content: '검색 결과', isError: false }),
    }),
}));
jest.mock('../config/runtime-limits', () => {
    const actual = jest.requireActual('../config/runtime-limits');
    return {
        ...actual,
        AGENT_LOOP_LIMITS: { ...actual.AGENT_LOOP_LIMITS, MAX_TURNS: 8, MAX_WALL_CLOCK_MS: 0 },
        CHAT_SUBAGENT: { ...actual.CHAT_SUBAGENT, ENABLED: false },
        AGENT_SPAWN: { ...actual.AGENT_SPAWN, ENABLED: false },
        LOOP_DETECTION: { ...actual.LOOP_DETECTION, SAME_TOOL_WARN_AT: 3, SAME_TOOL_BREAK_AT: 5 },
    };
});

import { streamFromExternalProvider } from '../services/chat-service/external-fallback';

const FINAL = '수집한 정보로 작성한 최종 답변입니다.';

/** 도구가 주어지면 매번 *다른 인자* 로 web_search 를 호출하는 fake provider. */
function makeResolved(seen: Array<{ hadTools: boolean; msgs: Array<{ role: string; content?: string }> }>) {
    let n = 0;
    return {
        providerId: 'local-llm',
        modelId: 'test-model',
        fullId: 'local-llm:test-model',
        provider: {
            getCapabilities: () => ({ vision: false, toolCalling: true }),
            streamChat: jest.fn().mockImplementation(async (opts: any, cbs: any) => {
                const hadTools = Array.isArray(opts.tools) && opts.tools.length > 0;
                seen.push({ hadTools, msgs: (opts.messages ?? []).map((m: any) => ({ role: m.role, content: m.content })) });
                n++;
                if (hadTools) {
                    // 인자를 매번 바꾼다 — 기존 doom-loop(도구+인자 해시)에는 걸리지 않는다.
                    return {
                        content: '', finishReason: 'tool_calls',
                        toolCalls: [{ id: `t${n}`, name: 'web_search', args: { query: `검색어 ${n}` } }],
                    };
                }
                cbs?.onToken?.(FINAL);
                return { content: FINAL, toolCalls: [], finishReason: 'stop' };
            }),
        },
    } as any;
}

const webSearchTool = {
    type: 'function' as const,
    function: { name: 'web_search', description: '웹 검색', parameters: { type: 'object', properties: {} } },
};

async function run(seen: Parameters<typeof makeResolved>[0]) {
    return streamFromExternalProvider(
        { currentUserContext: null, allowedTools: [webSearchTool] } as any,
        makeResolved(seen),
        { message: '엔비디아 주가 알려줘', userId: 'guest', history: [] } as any,
        () => {},
        {},
    );
}

describe('External Provider — 같은 도구 반복 사용 가드', () => {
    it('인자를 바꿔 반복해도 상한에 도달하면 도구를 끄고 답변을 강제한다', async () => {
        const seen: Array<{ hadTools: boolean; msgs: Array<{ role: string; content?: string }> }> = [];
        const result = await run(seen);

        // BREAK(5회) 도달 후에는 도구 없는 마무리 턴이 실행된다.
        const toolTurns = seen.filter(s => s.hadTools).length;
        expect(toolTurns).toBe(5);
        expect(seen[seen.length - 1]!.hadTools).toBe(false);
        expect(result).toBe(FINAL);
    });

    it('WARN 임계에서 마무리 유도 메시지를 1회만 넣는다', async () => {
        const seen: Array<{ hadTools: boolean; msgs: Array<{ role: string; content?: string }> }> = [];
        await run(seen);

        const lastMsgs = seen[seen.length - 1]!.msgs;
        const warns = lastMsgs.filter(m => (m.content ?? '').includes('이미 3회 호출했습니다'));
        expect(warns).toHaveLength(1);
    });

    it('차단 메시지는 도구 능력 부정을 막는 문구를 포함한다', async () => {
        const seen: Array<{ hadTools: boolean; msgs: Array<{ role: string; content?: string }> }> = [];
        await run(seen);

        const lastMsgs = seen[seen.length - 1]!.msgs;
        const stop = lastMsgs.find(m => (m.content ?? '').includes('더 검색하지 말고'));
        expect(stop).toBeDefined();
        expect(stop!.content).toContain('"검색 불가"라고 말하지 마세요');
    });
});
