/**
 * ExternalMCPClient — 비샌드박스 호스트 spawn 의 제어 env 제거 (2026-10-09 점검 ④, 심층 방어).
 *
 * 제어 키(NODE_OPTIONS 등)는 저장 시 거부되지만, 과거에 저장된 행이 그대로 spawn 에 들어가지 않도록
 * StdioClientTransport 에 넘기는 env 에서도 걷어낸다.
 */
const transportOptions: Array<{ env?: Record<string, string> }> = [];

class FakeClient {
    onclose?: () => void;
    connect = jest.fn(async (_transport: unknown) => undefined);
    listTools = jest.fn(async () => ({ tools: [] }));
    close = jest.fn(async () => undefined);
}

jest.mock('@modelcontextprotocol/client', () => ({
    Client: FakeClient,
    StreamableHTTPClientTransport: class {},
    SSEClientTransport: class {},
}));
jest.mock('@modelcontextprotocol/client/stdio', () => ({
    StdioClientTransport: class {
        stderr = null;
        constructor(opts: { env?: Record<string, string> }) { transportOptions.push(opts); }
    },
}));
jest.mock('../sandbox-docker', () => ({
    buildSandboxedCommand: (p: { command: string; args: string[] }) => ({ sandboxed: false, command: p.command, args: p.args }),
}));
jest.mock('../oauth-provider', () => ({ McpOAuthProvider: class {} }));
jest.mock('../../../security/ssrf-guard', () => ({ createPinnedFetch: () => fetch }));

import { ExternalMCPClient } from '../external-client';
import type { MCPServerConfig } from '../../../tool-contract/types';

beforeEach(() => { transportOptions.length = 0; });

describe('ExternalMCPClient — 비샌드박스 spawn env', () => {
    it('제어 키(NODE_OPTIONS·LD_PRELOAD)는 빼고 나머지 env 는 그대로 넘긴다', async () => {
        const config = {
            id: 'mcp_3_x', name: 'x', transport_type: 'stdio', command: '/usr/bin/node', args: ['cli.js'],
            env: { NODE_OPTIONS: '--require /x', LD_PRELOAD: '/x.so', API_KEY: 'k1', HOME: '/cache' },
        } as unknown as MCPServerConfig;
        await new ExternalMCPClient(config).connect();

        expect(transportOptions).toHaveLength(1);
        expect(transportOptions[0]!.env).toEqual({ API_KEY: 'k1', HOME: '/cache' });
    });

    it('env 가 없으면 undefined 를 넘긴다(SDK 기본 환경 사용)', async () => {
        const config = {
            id: 'mcp_3_y', name: 'y', transport_type: 'stdio', command: '/usr/bin/node', args: ['cli.js'],
        } as unknown as MCPServerConfig;
        await new ExternalMCPClient(config).connect();

        expect(transportOptions[0]!.env).toBeUndefined();
    });
});
