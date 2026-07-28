/**
 * collectUserPoolTools unit tests
 *
 * UserMCPPool 순회 helper 의 네임스페이스 적용 / 충돌 회피 로직 검증.
 */
import { collectUserPoolTools } from '../user-pool-tools';
import type { ExternalMCPClient } from '../external-client';
import type { MCPTool } from '../types';

function fakeClient(serverId: string, serverName: string, tools: MCPTool[]): ExternalMCPClient {
    return {
        getStatus: () => ({ serverId, serverName, status: 'connected', toolCount: tools.length }),
        getTools: () => tools,
        getConfig: () => ({ id: serverId, name: serverName, transport_type: 'stdio' }),
    } as unknown as ExternalMCPClient;
}

describe('collectUserPoolTools', () => {
    it('빈 userPool → 빈 배열', () => {
        const pool = { forUser: function* () { /* empty */ } } as any;
        expect(collectUserPoolTools(pool, 'user-1')).toEqual([]);
    });

    it('단일 서버 도구를 server.name::tool 네임스페이스로 반환', () => {
        const tools: MCPTool[] = [
            { name: 'scrape', description: 'Scrape URL', inputSchema: { type: 'object', properties: {} } },
        ];
        const client = fakeClient('mcp_3_abc', 'Firecrawl-MCP-Server', tools);
        const pool = {
            forUser: function* (uid: string) {
                if (uid === 'user-1') yield ['mcp_3_abc', client];
            },
        } as any;
        const out = collectUserPoolTools(pool, 'user-1');
        expect(out).toHaveLength(1);
        expect(out[0].tool.name).toBe('Firecrawl-MCP-Server::scrape');
        expect(out[0].serverId).toBe('mcp_3_abc');
        expect(out[0].catalogTemplateId).toBeUndefined();
    });

    it('동일 server.name 충돌 시 두 번째에 server.id 끝 6자리 suffix', () => {
        const client1 = fakeClient('mcp_3_abc111111', 'duck', [
            { name: 'search', description: '', inputSchema: { type: 'object', properties: {} } },
        ]);
        const client2 = fakeClient('mcp_3_def222222', 'duck', [
            { name: 'search', description: '', inputSchema: { type: 'object', properties: {} } },
        ]);
        const pool = {
            forUser: function* () {
                yield ['mcp_3_abc111111', client1];
                yield ['mcp_3_def222222', client2];
            },
        } as any;
        const out = collectUserPoolTools(pool, 'user-1');
        expect(out.map(o => o.tool.name)).toEqual(['duck::search', 'duck (222222)::search']);
    });
});
