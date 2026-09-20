/**
 * ExternalMCPClient — 호스트 프로토콜용 인자 숨김 (2026-09-15).
 *
 * 배경: open-design 도구 스키마의 `pluginWorkflowId`(서버 발급 불투명 값)에 qwen3.8-27b 가 임의 UUID 를
 * 넣어 `daemon 404 plugin workflow run not found` 로 모든 호출이 실패했다. 스키마에서 빼고, 호출에서도 걷어낸다.
 */
const sdkClients: FakeClient[] = [];

class FakeClient {
    onclose?: () => void;
    constructor() { sdkClients.push(this); }
    connect = jest.fn(async (_transport: unknown) => undefined);
    listTools = jest.fn(async () => ({
        tools: [{
            name: 'list_projects',
            inputSchema: {
                type: 'object',
                properties: {
                    pluginWorkflowId: { type: 'string', description: 'Opaque workflow id … never invent' },
                    limit: { type: 'number' },
                },
                required: ['pluginWorkflowId', 'limit'],
            },
        }],
    }));
    callTool = jest.fn(async (_req: { name: string; arguments: Record<string, unknown> }) => ({ content: [{ type: 'text', text: '{"projects":[]}' }] }));
    close = jest.fn(async () => undefined);
}

jest.mock('@modelcontextprotocol/client', () => ({
    Client: FakeClient,
    StreamableHTTPClientTransport: class {},
    SSEClientTransport: class {},
}));
jest.mock('@modelcontextprotocol/client/stdio', () => ({ StdioClientTransport: class { stderr = null; } }));
jest.mock('../sandbox-docker', () => ({
    buildSandboxedCommand: (p: { command: string; args: string[] }) => ({ sandboxed: false, command: p.command, args: p.args }),
}));
jest.mock('../oauth-provider', () => ({ McpOAuthProvider: class {} }));
jest.mock('../../../security/ssrf-guard', () => ({ createPinnedFetch: () => fetch }));

import { ExternalMCPClient } from '../external-client';
import type { MCPServerConfig } from '../../../tool-contract/types';

const config = {
    id: 'mcp_3_od', name: 'open-design', transport_type: 'stdio', command: '/usr/bin/node', args: ['cli.js', 'mcp'],
} as unknown as MCPServerConfig;

beforeEach(() => { sdkClients.length = 0; });

describe('ExternalMCPClient — 호스트 프로토콜 인자 숨김', () => {
    it('도구 스키마에서 pluginWorkflowId 를 properties·required 모두에서 뺀다', async () => {
        const c = new ExternalMCPClient(config);
        await c.connect();

        const [tool] = c.getTools();
        expect(Object.keys(tool.inputSchema.properties ?? {})).toEqual(['limit']);
        expect(tool.inputSchema.required).toEqual(['limit']);
    });

    it('모델이 지어낸 pluginWorkflowId 는 서버로 보내지 않고 나머지 인자는 그대로 보낸다', async () => {
        const c = new ExternalMCPClient(config);
        await c.connect();

        const r = await c.callTool('list_projects', { pluginWorkflowId: '0625381c-4a9c-4e5f-bd7b-84053060865b', limit: 5 });

        expect(r.isError).toBeFalsy();
        expect(sdkClients[0].callTool).toHaveBeenCalledWith({ name: 'list_projects', arguments: { limit: 5 } });
    });
});
