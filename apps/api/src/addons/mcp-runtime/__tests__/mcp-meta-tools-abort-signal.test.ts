/**
 * mcp_call 메타 도구의 중단 신호(#1474) — 바깥 실행(채팅·작업)의 신호가 mcp_call → ToolRouter.executeTool → 외부 실행기까지 간다.
 * 내장 도구 핸들러는 dispatchTool 이 넘기는 opts 로 신호를 받는다(서명에 opts 가 없던 기존 핸들러는 그대로 동작).
 */
import { ToolRouter } from '../tool-router';
import { mcpMetaTools } from '../mcp-meta-tools';
import { dispatchTool } from '../../../tool-contract/tool-dispatch';
import type { MCPTool, MCPToolResult } from '../../../tool-contract/types';

let router: ToolRouter;
jest.mock('../unified-client', () => ({ getUnifiedMCPClient: () => ({ getToolRouter: () => router }) }));

const echo: MCPTool = { name: 'echo', description: 'd', inputSchema: { type: 'object', properties: {} } };
const ctx = { userId: 'user-1', role: 'user' as const };
let seen: Array<AbortSignal | undefined>;

beforeEach(() => {
    seen = [];
    router = new ToolRouter();
    router.registerExternalTools('srv-global', 'everything', [echo], async (_n, _a, opts): Promise<MCPToolResult> => {
        seen.push(opts?.signal);
        return { content: [{ type: 'text', text: 'pong' }] };
    });
});

const builtInTools = () => mcpMetaTools;

describe('mcp_call — 바깥 신호 전파(#1474)', () => {
    it('dispatchTool 의 신호가 mcp_call 을 거쳐 외부 실행기가 받은 신호에 닿는다', async () => {
        const ac = new AbortController();
        const r = await dispatchTool('mcp_call', { server: 'everything', tool: 'echo', args: {} }, ctx, { builtInTools, external: router }, { signal: ac.signal });
        expect(r.isError).toBeFalsy();
        expect(seen).toHaveLength(1);
        expect(seen[0]?.aborted).toBe(false);
        ac.abort();
        expect(seen[0]?.aborted).toBe(true);
    });

    it('핸들러 직접 호출: opts 의 신호가 이미 중단됐으면 외부 호출 0회', async () => {
        const ac = new AbortController();
        ac.abort();
        const handler = mcpMetaTools.find((t) => t.tool.name === 'mcp_call')!.handler;
        const r = await handler({ server: 'everything', tool: 'echo', args: {} }, ctx, { signal: ac.signal });
        expect(seen).toHaveLength(0);
        expect(r.isError).toBe(true);
    });

    it('신호 없는 기존 호출은 그대로 실행된다', async () => {
        const r = await dispatchTool('mcp_call', { server: 'everything', tool: 'echo', args: {} }, ctx, { builtInTools, external: router });
        expect(r.isError).toBeFalsy();
        expect(seen).toHaveLength(1);
    });
});
