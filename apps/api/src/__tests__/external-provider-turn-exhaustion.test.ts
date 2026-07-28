/**
 * ============================================================
 * External Provider — 턴 예산 소진 시 최종 답변 강제 테스트
 * ============================================================
 *
 * 회귀: 리서치형 요청에서 모델이 MAX_TURNS(5) 전부를 도구 호출로 소진하면
 * 루프가 최종 답변 턴 없이 종료돼 content 가 빈/스텁 문자열로 반환됐다
 * (Discord 봇 "백엔드 응답에 content 가 없습니다" 오류, 2026-07-17).
 * 수정: 마지막 턴이 도구 호출로 끝나면 도구를 끈 마무리 턴을 1회 실행해
 * 답변 본문을 강제한다 (wall-clock/doom-loop 가드와 동일 패턴).
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
import { AGENT_LOOP_LIMITS } from '../config/runtime-limits';

const FINAL_ANSWER = '수집한 정보 기반 최종 답변 본문입니다.';

/**
 * 도구가 주어지면 매번 (서로 다른 인자의) web_search 호출만 반환하고,
 * 도구가 없으면 최종 답변 텍스트를 반환하는 fake provider.
 * 인자를 턴마다 다르게 해 doom-loop 가드(동일 배치 3회)에 걸리지 않게 한다.
 */
function makeResolved(calls: Array<{ hadTools: boolean }>) {
    let n = 0;
    return {
        providerId: 'local-llm',
        modelId: 'test-model',
        fullId: 'local-llm:test-model',
        provider: {
            getCapabilities: () => ({ vision: false, toolCalling: true }),
            streamChat: jest.fn().mockImplementation(async (opts: any, cbs: any) => {
                n++;
                const hadTools = Array.isArray(opts.tools) && opts.tools.length > 0;
                calls.push({ hadTools });
                if (hadTools) {
                    return {
                        content: '',
                        toolCalls: [{ id: `t${n}`, name: 'web_search', args: { query: `쿼리 ${n}` } }],
                        finishReason: 'tool_calls',
                    };
                }
                cbs?.onToken?.(FINAL_ANSWER);
                return { content: FINAL_ANSWER, toolCalls: [], finishReason: 'stop' };
            }),
        },
    } as any;
}

const webSearchTool = {
    type: 'function' as const,
    function: { name: 'web_search', description: '웹 검색', parameters: { type: 'object', properties: {} } },
};

describe('External Provider — 턴 예산 소진 방어', () => {
    it('전 턴을 도구 호출로 소진하면 도구 비활성 최종 턴을 1회 실행해 답변을 강제한다', async () => {
        const calls: Array<{ hadTools: boolean }> = [];
        const streamed: string[] = [];
        const result = await streamFromExternalProvider(
            { currentUserContext: null, allowedTools: [webSearchTool] } as any,
            makeResolved(calls),
            { message: 'AI 논문 조사해서 보고서 작성해', userId: 'guest', history: [] } as any,
            (token) => { if (token) streamed.push(token); },
            {},
        );

        // MAX_TURNS 만큼 도구 턴 + 도구 없는 최종 턴 1회
        expect(calls.length).toBe(AGENT_LOOP_LIMITS.MAX_TURNS + 1);
        expect(calls.slice(0, -1).every((c) => c.hadTools)).toBe(true);
        expect(calls[calls.length - 1].hadTools).toBe(false);

        // 최종 반환/스트림 모두 답변 본문 포함 (빈 content 회귀 차단)
        expect(result).toBe(FINAL_ANSWER);
        expect(streamed.join('')).toContain(FINAL_ANSWER);
    });

    it('도구 호출 없이 즉시 답하면 추가 턴 없이 1회로 끝난다 (기존 동작 불변)', async () => {
        const calls: Array<{ hadTools: boolean }> = [];
        const resolved = makeResolved(calls);
        // 첫 호출부터 도구 없이 답하도록: allowedTools 를 비워 tools 미전달 경로 사용
        const result = await streamFromExternalProvider(
            { currentUserContext: null, allowedTools: [] } as any,
            resolved,
            { message: '안녕', userId: 'guest', history: [] } as any,
            () => {},
            {},
        );
        expect(calls.length).toBe(1);
        expect(result).toBe(FINAL_ANSWER);
    });
});
