/**
 * MCP 서버 역할의 2026-07-28(modern era) 수용 — 실제 SDK 클라이언트로 고정한다.
 *
 * 우리 서버(`MCPServer`)를 stdio 루프와 같은 경로(`handleLine`)로 잇는 인메모리
 * transport 위에서 `@modelcontextprotocol/client` 2.x 의 세 협상 모드(legacy·auto·
 * pin 2026-07-28)가 tools/list·tools/call 을 왕복하는지 본다.
 *
 * - 플래그 ON: 세 모드 모두 통과, auto·pin 은 modern(2026-07-28)으로 협상
 * - 플래그 OFF: 종전 그대로 — auto 는 legacy 로 폴백, pin 은 실패, server/discover 는 -32601
 */
import { Client } from '@modelcontextprotocol/client';
import { MCPServer } from '../server';
import { isModernServingEnabled } from '../mcp-protocol-modern';

type Msg = Record<string, unknown>;

/** 클라이언트 ↔ MCPServer.handleLine 을 잇는 stdio 모양 transport(줄 단위 JSON). */
class LineTransport {
    onmessage?: (m: Msg) => void;
    onclose?: () => void;
    onerror?: (e: Error) => void;
    readonly sent: Msg[] = [];
    constructor(private readonly server: MCPServer) {}
    async start(): Promise<void> { /* no-op */ }
    async send(message: Msg): Promise<void> {
        this.sent.push(message);
        const out = await this.server.handleLine(JSON.stringify(message));
        if (out !== null) setImmediate(() => this.onmessage?.(JSON.parse(out)));
    }
    async close(): Promise<void> { this.onclose?.(); }
}

function makeServer(modernProtocol: boolean): MCPServer {
    const server = new MCPServer('openmake-test', '9.9.9', { modernProtocol });
    server.registerTool({
        tool: {
            name: 'echo_test',
            description: 'echo',
            inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
        },
        handler: async (args: Record<string, unknown>) => ({
            content: [{ type: 'text', text: `echo:${String(args.text)}` }],
        }),
    } as Parameters<MCPServer['registerTool']>[0]);
    return server;
}

type Mode = 'legacy' | 'auto' | { pin: string };

async function roundTrip(server: MCPServer, mode: Mode) {
    const transport = new LineTransport(server);
    const client = new Client(
        { name: 'modern-test-client', version: '1.0.0' },
        { versionNegotiation: { mode, probe: { timeoutMs: 2000 } } },
    );
    await client.connect(transport as never);
    try {
        const tools = await client.listTools();
        const call = await client.callTool({ name: 'echo_test', arguments: { text: 'hi' } });
        return {
            version: client.getNegotiatedProtocolVersion?.(),
            toolNames: tools.tools.map((t) => t.name),
            text: (call.content as Array<{ type: string; text?: string }>)[0]?.text,
            sentMethods: transport.sent.map((m) => m.method).filter(Boolean),
        };
    } finally {
        await client.close();
    }
}

describe('MCPServer modern era(2026-07-28) — 플래그 ON', () => {
    it('pin 2026-07-28 클라이언트: discover 후 tools/list·tools/call 통과', async () => {
        const r = await roundTrip(makeServer(true), { pin: '2026-07-28' });
        expect(r.version).toBe('2026-07-28');
        expect(r.sentMethods).toContain('server/discover');
        expect(r.sentMethods).not.toContain('initialize');
        expect(r.toolNames).toContain('echo_test');
        expect(r.text).toBe('echo:hi');
    });

    it('auto 클라이언트: modern 으로 협상', async () => {
        const r = await roundTrip(makeServer(true), 'auto');
        expect(r.version).toBe('2026-07-28');
        expect(r.sentMethods).not.toContain('initialize');
        expect(r.text).toBe('echo:hi');
    });

    it('legacy 클라이언트: 종전 initialize 로 통과(구 리비전 수용 유지)', async () => {
        const r = await roundTrip(makeServer(true), 'legacy');
        expect(r.version).toBe('2025-11-25');
        expect(r.sentMethods).toContain('initialize');
        expect(r.text).toBe('echo:hi');
    });

    it('모르는 modern 리비전 봉투는 -32022 와 지원 목록', async () => {
        const res = await makeServer(true).handleRequest({
            jsonrpc: '2.0', id: 7, method: 'tools/list',
            params: { _meta: { 'io.modelcontextprotocol/protocolVersion': '2099-01-01' } },
        });
        expect(res.error?.code).toBe(-32022);
        expect((res.error?.data as { supported: string[] }).supported).toContain('2026-07-28');
    });

    it('modern 결과는 resultType·캐시 힌트·serverInfo 를 싣는다', async () => {
        const res = await makeServer(true).handleRequest({
            jsonrpc: '2.0', id: 8, method: 'tools/list',
            params: { _meta: { 'io.modelcontextprotocol/protocolVersion': '2026-07-28', 'io.modelcontextprotocol/clientCapabilities': {} } },
        });
        const result = res.result as Record<string, unknown>;
        expect(result.resultType).toBe('complete');
        expect(result.ttlMs).toBe(0);
        expect(result.cacheScope).toBe('private');
        expect((result._meta as Record<string, unknown>)['io.modelcontextprotocol/serverInfo'])
            .toEqual({ name: 'openmake-test', version: '9.9.9' });
    });

    it('봉투 없는 요청(구 리비전)은 결과 형태가 종전과 같다', async () => {
        const on = await makeServer(true).handleRequest({ jsonrpc: '2.0', id: 9, method: 'tools/list' });
        const off = await makeServer(false).handleRequest({ jsonrpc: '2.0', id: 9, method: 'tools/list' });
        expect(on).toEqual(off);
    });
});

describe('MCPServer modern era — 플래그 OFF(기본, 종전 동작)', () => {
    it('server/discover 는 -32601', async () => {
        const res = await makeServer(false).handleRequest({ jsonrpc: '2.0', id: 1, method: 'server/discover' });
        expect(res.error?.code).toBe(-32601);
    });

    it('auto 클라이언트는 discover 거절 뒤 initialize 로 폴백한다', async () => {
        const server = makeServer(false);
        const transport = new LineTransport(server);
        const client = new Client(
            { name: 'modern-test-client', version: '1.0.0' },
            { versionNegotiation: { mode: 'auto', probe: { timeoutMs: 2000 } } },
        );
        // OFF 의 initialize 응답은 종전 그대로(불리언 capability)라 SDK 2.x 는 연결을 거절한다
        // — 그 결함은 ON 에서만 고친다(아래 initialize 형태 테스트). 여기서는 폴백 경로만 본다.
        await client.connect(transport as never).catch(() => undefined);
        await client.close().catch(() => undefined);
        const methods = transport.sent.map((m) => m.method);
        expect(methods.indexOf('server/discover')).toBeGreaterThanOrEqual(0);
        expect(methods.indexOf('initialize')).toBeGreaterThan(methods.indexOf('server/discover'));
    });

    it('pin 2026-07-28 클라이언트는 연결 실패', async () => {
        await expect(roundTrip(makeServer(false), { pin: '2026-07-28' })).rejects.toBeDefined();
    });

    it('initialize 응답은 종전 형태 그대로(capability 불리언), ON 은 사양 형태', async () => {
        const req = { jsonrpc: '2.0' as const, id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25' } };
        const off = (await makeServer(false).handleRequest(req)).result as Record<string, unknown>;
        const on = (await makeServer(true).handleRequest(req)).result as Record<string, unknown>;
        expect(off.capabilities).toEqual({ tools: true, resources: false, prompts: false });
        expect(on.capabilities).toEqual({ tools: {} });
        expect(off.protocolVersion).toBe(on.protocolVersion);
    });

    it('stdio 줄 처리: OFF 면 봉투 알림에도 종전처럼 응답한다', async () => {
        const line = JSON.stringify({
            jsonrpc: '2.0', method: 'notifications/cancelled',
            params: { requestId: 1, _meta: { 'io.modelcontextprotocol/protocolVersion': '2026-07-28' } },
        });
        expect(await makeServer(false).handleLine(line)).not.toBeNull();
        expect(await makeServer(true).handleLine(line)).toBeNull();
    });

    it('env 미설정이면 꺼짐, "true" 만 켜짐', () => {
        expect(isModernServingEnabled({})).toBe(false);
        expect(isModernServingEnabled({ MCP_SERVER_MODERN_PROTOCOL: 'false' })).toBe(false);
        expect(isModernServingEnabled({ MCP_SERVER_MODERN_PROTOCOL: 'true' })).toBe(true);
    });

    it('옵션 없이 만들면 env 를 따른다(미설정 = OFF)', async () => {
        const prev = process.env.MCP_SERVER_MODERN_PROTOCOL;
        delete process.env.MCP_SERVER_MODERN_PROTOCOL;
        try {
            const res = await new MCPServer('x', '1').handleRequest({ jsonrpc: '2.0', id: 1, method: 'server/discover' });
            expect(res.error?.code).toBe(-32601);
        } finally {
            if (prev !== undefined) process.env.MCP_SERVER_MODERN_PROTOCOL = prev;
        }
    });
});
