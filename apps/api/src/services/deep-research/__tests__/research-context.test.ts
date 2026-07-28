/**
 * 딥리서치 컨텍스트 단위 테스트 — 스킬 주입 + MCP 근거 수집.
 *
 * 배경(2026-07-26 점검): 딥리서치는 웹검색 전용 파이프라인이라 MCP 도구도 스킬도
 * 전달되지 않았다. 붙이되 **도구폭주**(전체 카탈로그 전달 시 vLLM 문법 컴파일
 * 101s 실측)를 재유발하지 않는 것이 핵심 제약이다.
 */
const buildManifestPromptMock = jest.fn();
const getLLMToolsMock = jest.fn();
const executeToolMock = jest.fn();
const selectToolsMock = jest.fn();

jest.mock('../../../agents/skill-manager', () => ({
    getSkillManager: () => ({ buildManifestPrompt: buildManifestPromptMock }),
}));
jest.mock('../../../mcp/unified-client', () => ({
    getUnifiedMCPClient: () => ({
        getToolRouter: () => ({ getLLMTools: getLLMToolsMock }),
        executeToolWithContext: executeToolMock,
    }),
}));
jest.mock('../../agent-task/tool-selector-embedding', () => ({
    selectRelevantToolsEmbedding: (...args: unknown[]) => selectToolsMock(...args),
}));
jest.mock('../../chat-service/tool-restrictions', () => ({
    filterRestrictedTools: (tools: unknown) => tools,
}));

import { buildResearchSkillBlock, withSkillContext, gatherMcpEvidence } from '../research-context';

const tool = (name: string) => ({
    type: 'function' as const,
    function: { name, description: 'd', parameters: { type: 'object', properties: {} } },
});

beforeEach(() => {
    buildManifestPromptMock.mockReset();
    getLLMToolsMock.mockReset().mockResolvedValue([tool('notebook_query'), tool('web_search')]);
    executeToolMock.mockReset();
    selectToolsMock.mockReset().mockResolvedValue([tool('notebook_query')]);
});

describe('buildResearchSkillBlock / withSkillContext', () => {
    it('활성 스킬 매니페스트를 반환하고 프롬프트 앞에 붙인다', async () => {
        buildManifestPromptMock.mockResolvedValue('## 적용된 스킬\n내용');
        const block = await buildResearchSkillBlock('u1');
        expect(block).toContain('적용된 스킬');
        expect(withSkillContext('원본 프롬프트', block)).toBe('## 적용된 스킬\n내용\n\n---\n\n원본 프롬프트');
    });

    it('게스트·미지정 사용자는 조회하지 않는다', async () => {
        expect(await buildResearchSkillBlock(undefined)).toBe('');
        expect(await buildResearchSkillBlock('guest')).toBe('');
        expect(buildManifestPromptMock).not.toHaveBeenCalled();
    });

    it('조회 실패는 빈 문자열 — 리서치를 막지 않는다', async () => {
        buildManifestPromptMock.mockRejectedValue(new Error('db down'));
        expect(await buildResearchSkillBlock('u1')).toBe('');
    });

    it('블록이 비면 프롬프트를 그대로 둔다', () => {
        expect(withSkillContext('p', '')).toBe('p');
    });
});

describe('gatherMcpEvidence', () => {
    const makeClient = (toolCalls: Array<{ function: { name: string; arguments: unknown } }>) => ({
        chat: jest.fn().mockResolvedValue({ role: 'assistant', content: '', tool_calls: toolCalls }),
    }) as never;

    it('도구 결과를 SearchResult(mcp:// 스킴)로 변환한다', async () => {
        executeToolMock.mockResolvedValue({ content: [{ type: 'text', text: '사내 매출 데이터 요약: 2026년 1분기 매출 42억원, 전년 동기 대비 18% 증가했습니다.' }] });
        const out = await gatherMcpEvidence({
            client: makeClient([{ function: { name: 'notebook_query', arguments: {} } }]),
            topic: '매출 추이',
            userId: 'u1',
        });
        expect(out).toHaveLength(1);
        expect(out[0].url).toMatch(/^mcp:\/\/notebook_query/);
        expect(out[0].fullContent).toContain('42억');
        expect(out[0].source).toBe('mcp/notebook_query');
    });

    it('도구를 하나도 호출하지 않으면 빈 배열 (웹 소스만 사용)', async () => {
        const out = await gatherMcpEvidence({
            client: makeClient([]), topic: 't', userId: 'u1',
        });
        expect(out).toEqual([]);
        expect(executeToolMock).not.toHaveBeenCalled();
    });

    it('도구 선별에 예산을 넘겨 도구폭주를 막는다', async () => {
        await gatherMcpEvidence({ client: makeClient([]), topic: 't', userId: 'u1' });
        const opts = selectToolsMock.mock.calls[0][2] as { budget: number; exclude: Set<string> };
        expect(opts.budget).toBeGreaterThan(0);
        expect(opts.budget).toBeLessThanOrEqual(16);
        // 웹검색류는 파이프라인이 이미 수행 → 제외 목록에 포함
        expect(opts.exclude.has('web_search')).toBe(true);
    });

    it('게스트·미지정 사용자는 수집하지 않는다', async () => {
        expect(await gatherMcpEvidence({ client: makeClient([]), topic: 't' })).toEqual([]);
        expect(await gatherMcpEvidence({ client: makeClient([]), topic: 't', userId: 'guest' })).toEqual([]);
    });

    it('개별 도구 실행 실패는 건너뛰고 나머지를 채택한다', async () => {
        executeToolMock
            .mockRejectedValueOnce(new Error('boom'))
            .mockResolvedValueOnce({ content: [{ type: 'text', text: '두 번째 도구가 반환한 근거 본문입니다. 최소 채택 길이를 넘도록 충분히 서술합니다.' }] });
        const out = await gatherMcpEvidence({
            client: makeClient([
                { function: { name: 'a', arguments: {} } },
                { function: { name: 'b', arguments: {} } },
            ]),
            topic: 't', userId: 'u1',
        });
        expect(out).toHaveLength(1);
        expect(out[0].source).toBe('mcp/b');
    });

    it('LLM 호출 실패는 빈 배열 — 리서치 본류를 막지 않는다', async () => {
        const client = { chat: jest.fn().mockRejectedValue(new Error('llm down')) } as never;
        expect(await gatherMcpEvidence({ client, topic: 't', userId: 'u1' })).toEqual([]);
    });

    it('너무 짧은 결과는 근거로 채택하지 않는다', async () => {
        executeToolMock.mockResolvedValue({ content: [{ type: 'text', text: 'ok' }] });
        const out = await gatherMcpEvidence({
            client: makeClient([{ function: { name: 'x', arguments: {} } }]),
            topic: 't', userId: 'u1',
        });
        expect(out).toEqual([]);
    });
});
