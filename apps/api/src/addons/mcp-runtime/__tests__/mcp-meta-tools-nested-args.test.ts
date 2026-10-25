/**
 * mcp_call — 중첩 args 의 위험 인자를 실행 전에 막는다(E6).
 * 바깥 mcp_call 호출의 최상위 검사는 args 객체 안을 보지 않으므로, 핸들러가 직접 깊이 검사한다.
 */
import { ToolRouter } from '../tool-router';
import { mcpMetaTools } from '../mcp-meta-tools';
import type { MCPTool, MCPToolResult } from '../../../tool-contract/types';

let router: ToolRouter;
jest.mock('../unified-client', () => ({ getUnifiedMCPClient: () => ({ getToolRouter: () => router }) }));

const mcpCall = mcpMetaTools.find((t) => t.tool.name === 'mcp_call')!.handler;
const textOf = (r: MCPToolResult): string => r.content.map((c) => ('text' in c ? c.text : '')).join('');
const ctx = { userId: 'user-1' } as never;
const run: MCPTool = { name: 'run', description: '실행', inputSchema: { type: 'object', properties: {} } };

describe('mcp_call × 중첩 인자 검사', () => {
    const calls: Array<Record<string, unknown>> = [];
    beforeEach(() => {
        calls.length = 0;
        router = new ToolRouter();
        router.registerExternalTools('srv-global', 'everything', [run], async (_name, args) => {
            calls.push(args);
            return { content: [{ type: 'text', text: 'ran' }] };
        });
    });

    it('중첩 객체·배열 안의 위험 인자는 실행하지 않고 차단 문구를 돌려준다', async () => {
        const r = await mcpCall({ server: 'everything', tool: 'run', args: { opts: { steps: [{ command: 'ls; rm -rf /' }] } } }, ctx);
        expect(textOf(r)).toContain('차단된 도구 인자: opts.steps[0].command');
        expect(textOf(r)).toContain('[shell]');
        expect(textOf(r)).not.toContain('rm -rf');
        expect(calls).toHaveLength(0);
    });

    it('args 최상위의 위험 인자도 차단한다', async () => {
        const r = await mcpCall({ server: 'everything', tool: 'run', args: { cmd: 'a && b' } }, ctx);
        expect(textOf(r)).toContain('차단된 도구 인자: cmd');
        expect(calls).toHaveLength(0);
    });

    it('위험 패턴이 없는 중첩 인자는 그대로 실행한다', async () => {
        const args = { opts: { steps: [{ command: 'ls -la' }], note: 'hello' } };
        const r = await mcpCall({ server: 'everything', tool: 'run', args }, ctx);
        expect(textOf(r)).toBe('ran');
        expect(calls).toEqual([args]);
    });
});
