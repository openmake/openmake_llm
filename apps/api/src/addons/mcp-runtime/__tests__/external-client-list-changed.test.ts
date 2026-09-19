/**
 * 도구 목록 갱신(F13.12, 133) — listChanged 알림이 오면 목록을 바꾸고 tools_changed 를 발행한다.
 * 알림을 광고하지 않는 서버는 stale 판정(MCP_TOOL_LIST_STALE_MS)으로 tools/list 를 다시 부른다.
 */
import { PassThrough } from 'stream';

const clients: FakeClient[] = [];
type OnChanged = (error: Error | null, tools: unknown[] | null) => void;

class FakeStdioTransport {
    stderr = new PassThrough();
    constructor(public params: unknown) {}
}
class FakeClient {
    onclose?: () => void;
    onChanged?: OnChanged;
    constructor(_info: unknown, opts: { listChanged?: { tools?: { onChanged: OnChanged } } }) {
        this.onChanged = opts.listChanged?.tools?.onChanged;
        clients.push(this);
    }
    connect = jest.fn(async () => undefined);
    listTools = jest.fn(async () => ({ tools: [{ name: 'a', inputSchema: { type: 'object' } }] }));
    callTool = jest.fn();
    close = jest.fn(async () => { this.onclose?.(); });
}

jest.mock('@modelcontextprotocol/client', () => ({ Client: FakeClient, StreamableHTTPClientTransport: class {}, SSEClientTransport: class {} }));
jest.mock('@modelcontextprotocol/client/stdio', () => ({ StdioClientTransport: FakeStdioTransport }));
jest.mock('../sandbox-docker', () => ({ buildSandboxedCommand: (p: { command: string; args: string[] }) => ({ sandboxed: false, command: p.command, args: p.args }) }));
jest.mock('../oauth-provider', () => ({ McpOAuthProvider: class {} }));
jest.mock('../../../security/ssrf-guard', () => ({ createPinnedFetch: () => fetch }));
let staleMs = 600_000;
jest.mock('../../../config/env', () => ({ getConfig: () => ({ mcpToolListStaleMs: staleMs }) }));

import { ExternalMCPClient } from '../external-client';
import type { MCPServerConfig } from '../../../tool-contract/types';

const config = { id: 'mcp_3_od', name: 'open-design', transport_type: 'stdio', command: '/usr/bin/node', args: ['cli.js'], sandbox_network: 'host' } as unknown as MCPServerConfig;

async function connected() {
    const c = new ExternalMCPClient(config);
    await c.connect();
    return { c, sdk: clients[clients.length - 1] };
}
beforeEach(() => { clients.length = 0; staleMs = 600_000; });

describe('ExternalMCPClient — 도구 목록 갱신', () => {
    it('listChanged 알림이 오면 목록을 교체하고 tools_changed 를 발행한다', async () => {
        const { c, sdk } = await connected();
        const changed = jest.fn();
        c.on('tools_changed', changed);
        expect(sdk.onChanged).toBeDefined();
        sdk.onChanged!(null, [{ name: 'a', inputSchema: { type: 'object' } }, { name: 'b', inputSchema: { type: 'object' } }]);
        expect(c.getTools().map((t) => t.name)).toEqual(['a', 'b']);
        expect(changed).toHaveBeenCalledWith(expect.objectContaining({ serverId: 'mcp_3_od', count: 2, source: 'list_changed' }));
    });

    it('알림 오류는 목록을 건드리지 않는다', async () => {
        const { c, sdk } = await connected();
        sdk.onChanged!(new Error('boom'), null);
        expect(c.getTools().map((t) => t.name)).toEqual(['a']);
    });

    it('stale 이 아니면 재조회하지 않고, stale 이면 tools/list 를 다시 불러 바뀐 경우만 발행한다', async () => {
        const { c, sdk } = await connected();
        const changed = jest.fn();
        c.on('tools_changed', changed);
        expect(await c.refreshToolsIfStale()).toBe(false);
        expect(sdk.listTools).toHaveBeenCalledTimes(1);
        // 시각을 미래로 — 같은 목록이면 발행 없음
        expect(await c.refreshToolsIfStale(Date.now() + 700_000)).toBe(true);
        expect(sdk.listTools).toHaveBeenCalledTimes(2);
        expect(changed).not.toHaveBeenCalled();
        sdk.listTools.mockResolvedValueOnce({ tools: [{ name: 'z', inputSchema: { type: 'object' } }] });
        expect(await c.refreshToolsIfStale(Date.now() + 1_400_000)).toBe(true);
        expect(c.getTools().map((t) => t.name)).toEqual(['z']);
        expect(changed).toHaveBeenCalledWith(expect.objectContaining({ count: 1, source: 'stale' }));
    });

    it('MCP_TOOL_LIST_STALE_MS=0 이면 끔, 재조회 실패는 삼키고 다음 판정까지 재시도하지 않는다', async () => {
        const { c, sdk } = await connected();
        staleMs = 0;
        expect(await c.refreshToolsIfStale(Date.now() + 10_000_000)).toBe(false);
        // 1ms 기준이면 실패 직후 1ms 만 지나도 다시 stale 이 돼 간헐 실패했다 — 기준을 넉넉히 두고 미래 시각으로 판정
        staleMs = 60_000;
        sdk.listTools.mockRejectedValueOnce(new Error('down'));
        expect(await c.refreshToolsIfStale(Date.now() + 120_000)).toBe(false);
        expect(c.getTools().map((t) => t.name)).toEqual(['a']);
        expect(await c.refreshToolsIfStale()).toBe(false); // 방금 실패 시각 갱신 → stale 아님
        expect(sdk.listTools).toHaveBeenCalledTimes(2);
    });

    it('동시 호출은 listTools 를 한 번만 부른다', async () => {
        const { c, sdk } = await connected();
        const later = Date.now() + 700_000;
        const [a, b] = await Promise.all([c.refreshToolsIfStale(later), c.refreshToolsIfStale(later)]);
        expect([a, b]).toEqual([true, true]);
        expect(sdk.listTools).toHaveBeenCalledTimes(2); // connect 1 + stale 1
    });
});
