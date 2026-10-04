/**
 * mcp_list_tools·mcp_call — 전역(visibility=global) MCP 서버도 찾아 쓴다.
 * 종전에는 사용자 풀만 봐서, 관리자가 전역으로 붙인 서버는 "설치된 서버가 없다"로 답했다.
 */
import { ToolRouter } from '../tool-router';
import { mcpMetaTools } from '../mcp-meta-tools';
import type { MCPTool, MCPToolResult } from '../../../tool-contract/types';

let router: ToolRouter;
jest.mock('../unified-client', () => ({ getUnifiedMCPClient: () => ({ getToolRouter: () => router }) }));

const handler = (name: string) => mcpMetaTools.find((t) => t.tool.name === name)!.handler;
const textOf = (r: MCPToolResult): string => r.content.map((c) => ('text' in c ? c.text : '')).join('');
const ctx = { userId: 'user-1' } as never;
const echo: MCPTool = { name: 'echo', description: '되돌려 준다', inputSchema: { type: 'object', properties: { message: { type: 'string' } } } };

describe('MCP 메타 도구 — 전역 서버', () => {
    const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
    beforeEach(() => {
        calls.length = 0;
        router = new ToolRouter();
        router.registerExternalTools('srv-global', 'everything', [echo], async (name, args) => {
            calls.push({ name, args });
            return { content: [{ type: 'text', text: 'pong' }] };
        });
    });

    it('mcp_list_tools: 서버를 비우면 전역 서버 이름을 돌려준다', async () => {
        const out = textOf(await handler('mcp_list_tools')({}, ctx));
        expect(out).toContain('everything');
        expect(out).not.toContain('없습니다');
    });

    it('mcp_list_tools: 전역 서버 이름으로 그 서버의 도구(이름·설명·입력 스키마)를 돌려준다', async () => {
        const out = textOf(await handler('mcp_list_tools')({ server: 'Everything' }, ctx));
        expect(out).toContain('"tool": "echo"');
        expect(out).toContain('되돌려 준다');
        expect(out).toContain('message');
    });

    it('mcp_call: 전역 서버의 도구를 원본 이름으로 실행한다', async () => {
        const r = await handler('mcp_call')({ server: 'everything', tool: 'echo', args: { message: 'hi' } }, ctx);
        expect(textOf(r)).toBe('pong');
        expect(calls).toEqual([{ name: 'echo', args: { message: 'hi' } }]);
    });

    it('전역 서버가 하나도 없고 설치한 서버도 없으면 종전 안내를 유지한다', async () => {
        router = new ToolRouter();
        expect(textOf(await handler('mcp_list_tools')({}, ctx))).toContain('없습니다');
    });
});
