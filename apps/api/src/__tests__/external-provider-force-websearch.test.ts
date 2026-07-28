/**
 * 명시적 웹 검색 요청 시 첫 턴 tool_choice=web_search 강제 검증.
 * 회귀: 봇 히스토리의 "검색 불가" 자기 발언 재주입 시 qwen 이 도구 호출을 거부 (2026-07-17).
 */
jest.mock('../utils/logger', () => ({ createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }) }));
jest.mock('../chat/prompt', () => ({ getExternalProviderSystemGuards: () => '[GUARD]' }));
jest.mock('../mcp/unified-client', () => ({ getUnifiedMCPClient: () => ({ executeToolWithContext: jest.fn().mockResolvedValue({ content: '결과', isError: false }) }) }));

import { streamFromExternalProvider } from '../services/chat-service/external-fallback';

const WS_TOOL = { type: 'function' as const, function: { name: 'web_search', description: 'd', parameters: { type: 'object', properties: {} } } };

function makeResolved(seenToolChoices: unknown[]) {
    return {
        providerId: 'local-llm', modelId: 'm', fullId: 'local-llm:m',
        provider: {
            getCapabilities: () => ({ vision: false, toolCalling: true }),
            streamChat: jest.fn().mockImplementation(async (opts: { tool_choice?: unknown }) => {
                seenToolChoices.push(opts.tool_choice);
                return { content: '답변', toolCalls: [], finishReason: 'stop' };
            }),
        },
    } as never;
}

describe('External Provider — 명시적 검색 요청 web_search 강제', () => {
    it('"인터넷을 검색해서" + 오염 히스토리 → 첫 턴 tool_choice=web_search', async () => {
        const seen: unknown[] = [];
        await streamFromExternalProvider(
            { currentUserContext: null, allowedTools: [WS_TOOL] } as never, makeResolved(seen),
            {
                message: '인터넷을 검색해서 오늘 서울 날씨 알려줘', userId: 'guest', history: [
                    { role: 'user', content: '완성은 됬는데 mcp를 사용하지 못하게 해서 그런거야 ??' },
                    { role: 'assistant', content: '저는 실시간 웹 검색 기능이 사용 불가능한 환경입니다.' },
                ],
            } as never,
            () => {}, {},
        );
        expect(seen[0]).toEqual({ type: 'function', function: { name: 'web_search' } });
    });

    it('검색 요청 아닌 일반 질문 → tool_choice 미강제', async () => {
        const seen: unknown[] = [];
        await streamFromExternalProvider(
            { currentUserContext: null, allowedTools: [WS_TOOL] } as never, makeResolved(seen),
            { message: '타입스크립트 제네릭 설명해줘', userId: 'guest', history: [] } as never,
            () => {}, {},
        );
        expect(seen[0]).toBeUndefined();
    });
});
