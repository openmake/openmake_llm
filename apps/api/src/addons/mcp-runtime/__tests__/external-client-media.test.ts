/**
 * ExternalMCPClient — 도구 결과의 이미지·오디오 블록은 base64 째로 돌려주지 않는다(media-content).
 */
const PNG = Buffer.from('png-bytes').toString('base64');

class FakeClient {
    onclose?: () => void;
    connect = jest.fn(async () => undefined);
    listTools = jest.fn(async () => ({ tools: [{ name: 'chart', inputSchema: { type: 'object' } }] }));
    callTool = jest.fn(async () => ({ content: [{ type: 'text', text: '완료' }, { type: 'image', data: PNG, mimeType: 'image/png' }, { type: 'audio', data: PNG, mimeType: 'audio/wav' }] }));
    close = jest.fn(async () => undefined);
}

jest.mock('@modelcontextprotocol/client', () => ({ Client: FakeClient, StreamableHTTPClientTransport: class {}, SSEClientTransport: class {} }));
jest.mock('@modelcontextprotocol/client/stdio', () => ({ StdioClientTransport: class { stderr = null; } }));
jest.mock('../sandbox-docker', () => ({ buildSandboxedCommand: (p: { command: string; args: string[] }) => ({ sandboxed: false, command: p.command, args: p.args }) }));
jest.mock('../oauth-provider', () => ({ McpOAuthProvider: class {} }));
jest.mock('../../../security/ssrf-guard', () => ({ createPinnedFetch: () => fetch }));

import { ExternalMCPClient } from '../external-client';
import { runWithToolMediaSink } from '../../../utils/tool-media-sink';
import type { MCPServerConfig } from '../../../tool-contract/types';

const config = { id: 'mcp_1', name: 'charts', transport_type: 'stdio', command: '/usr/bin/node', args: ['s.js'] } as unknown as MCPServerConfig;

describe('ExternalMCPClient — 비텍스트 결과', () => {
    it('저장처가 없으면(채팅) 생략 안내만 싣는다', async () => {
        const c = new ExternalMCPClient(config);
        await c.connect();
        const r = await c.callTool('chart', {});
        expect(r.content.map((x) => x.text)).toEqual(['완료', '[이미지 1건 생략 — image/png 9B]', '[오디오 1건 생략 — audio/wav 9B]']);
        expect(JSON.stringify(r)).not.toContain(PNG);
    });

    it('저장처가 있으면(에이전트 작업) 파일로 저장하고 경로를 싣는다', async () => {
        const c = new ExternalMCPClient(config);
        await c.connect();
        const saved: string[] = [];
        const r = await runWithToolMediaSink({ save: async (p) => { saved.push(p); } }, () => c.callTool('chart', {}));
        expect(saved).toHaveLength(2);
        expect(r.content.map((x) => x.text)).toEqual(['완료', `[이미지 저장됨: ${saved[0]} (image/png, 9B)]`, `[오디오 저장됨: ${saved[1]} (audio/wav, 9B)]`]);
    });
});
