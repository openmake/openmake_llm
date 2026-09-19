/**
 * Base 도구 디스패처 — MCP 런타임 add-on 없이도 내장 도구가 실행되고, 거버넌스(서킷·역할 게이트·훅·
 * required 인자·오류 분류)가 Base 에서 강제되는지 (Add-on 전환 P2, 2026-09-19).
 *
 * ⚠️ 이 판정이 깨지면 "MCP add-on 을 끄면 도구가 전부 죽는다" 는 뜻이다 — 경계 설계의 핵심 회귀 테스트다.
 */
import { dispatchTool, type ExternalToolDispatch } from '../tool-dispatch';
import type { MCPToolDefinition, MCPToolResult } from '../types';
import { __resetCircuitsForTest } from '../tool-health';
import { __resetToolHooksForTest, registerToolHook } from '../tool-hooks';

const handler = jest.fn(async (args: Record<string, unknown>): Promise<MCPToolResult> => ({
    content: [{ type: 'text', text: `ok:${JSON.stringify(args)}` }],
}));

const tools: MCPToolDefinition[] = [{
    tool: {
        name: 'fake_search',
        description: 'test',
        inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
    },
    handler,
} as unknown as MCPToolDefinition];

const builtInTools = () => tools;
const textOf = (r: MCPToolResult) => (r.content ?? []).map(c => ('text' in c ? c.text : '')).join('');

beforeEach(() => { handler.mockClear(); __resetCircuitsForTest(); __resetToolHooksForTest(); });

describe('dispatchTool — 내장 도구(외부 런타임 없음)', () => {
    it('내장 도구를 실행한다', async () => {
        const r = await dispatchTool('fake_search', { query: 'x' }, undefined, { builtInTools });
        expect(r.isError).toBeFalsy();
        expect(textOf(r)).toContain('ok:');
        expect(handler).toHaveBeenCalledTimes(1);
    });

    it('required 인자가 없으면 핸들러를 부르지 않고 invalid_args 로 돌려준다', async () => {
        const r = await dispatchTool('fake_search', {}, undefined, { builtInTools });
        expect(r.isError).toBe(true);
        expect(textOf(r)).toContain('필수 인자 누락 (fake_search): query');
        expect(handler).not.toHaveBeenCalled();
    });

    it('pre 훅의 deny 는 실행을 막는다 (거버넌스는 Base 에 있다)', async () => {
        registerToolHook({ id: 'deny-all', pre: () => ({ deny: '정책' }) });
        const r = await dispatchTool('fake_search', { query: 'x' }, undefined, { builtInTools });
        expect(r.isError).toBe(true);
        expect(textOf(r)).toContain('정책 훅에 의해 거절');
        expect(handler).not.toHaveBeenCalled();
    });

    it('MCP 런타임이 없으면 `::` 도구는 실행되지 않고 오류로 떨어진다', async () => {
        const r = await dispatchTool('srv::echo', {}, undefined, { builtInTools });
        expect(r.isError).toBe(true);
        expect(textOf(r)).toContain('외부 도구를 실행할 런타임이 없습니다');
    });

    it('없는 도구는 이름 제안과 함께 not-found', async () => {
        const r = await dispatchTool('fake_searc', {}, undefined, { builtInTools });
        expect(r.isError).toBe(true);
        expect(textOf(r)).toContain('도구를 찾을 수 없습니다');
    });
});

describe('dispatchTool — 외부 위임자가 붙은 경우', () => {
    const external: ExternalToolDispatch = {
        execute: jest.fn(async (name: string) => (name === 'srv::echo' ? { content: [{ type: 'text' as const, text: 'ext' }] } : undefined)),
        knownToolNames: jest.fn(async () => ['srv::echo']),
    };

    it('`::` 도구를 위임자에게 넘긴다', async () => {
        const r = await dispatchTool('srv::echo', { a: 1 }, undefined, { builtInTools, external });
        expect(textOf(r)).toBe('ext');
    });

    it('위임자가 모르는 이름이면 not-found 로 수렴한다', async () => {
        const r = await dispatchTool('srv::none', {}, undefined, { builtInTools, external });
        expect(r.isError).toBe(true);
        expect(textOf(r)).toContain('외부 도구를 찾을 수 없습니다');
    });
});
