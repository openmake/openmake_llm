/**
 * MCP-2 협상 방식 배선 — 실제 SDK 2.4 Client + 실제 stdio 자식(fixture)으로 확인한다.
 *
 * - legacy(기본): Client 에 versionNegotiation 키가 없고 connect 는 인자 1개(종전과 같은 호출).
 * - auto: 구 서버(v1 SDK)는 폴백해 연결, 새 서버(server/discover 전용)는 새 방식으로 연결.
 * - 재연결: 기억한 판정을 prior 로 넘겨 다시 탐지하지 않는다(형제 프로세스 0개).
 * - 조용한 구 서버: 탐지 타임아웃 뒤 폴백 — 첫 연결 지연은 타임아웃 + 여유 안.
 * - 연결 실패: 판정을 지워 다음 연결이 다시 탐지한다.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const settings: Record<string, string | undefined> = {};
jest.mock('../../../config/env', () => ({
    getConfig: () => ({ mcpToolListStaleMs: 0 }),
    readSettingValue: (k: string) => settings[k],
}));

const clientOpts: unknown[] = [];
const connectArgs: unknown[][] = [];
jest.mock('@modelcontextprotocol/client', () => {
    const actual = jest.requireActual('@modelcontextprotocol/client');
    class RecordingClient extends actual.Client {
        constructor(info: unknown, opts: unknown) {
            super(info, opts);
            clientOpts.push(opts);
        }
        connect(...args: unknown[]): Promise<void> {
            connectArgs.push(args);
            return super.connect(...args);
        }
    }
    return { ...actual, Client: RecordingClient };
});

jest.mock('../negotiation-observer', () => ({
    ...jest.requireActual('../negotiation-observer'),
    observeNegotiation: jest.fn(async () => undefined),
}));
jest.mock('../sandbox-egress', () => ({ prepareSandboxConfig: async () => undefined }));
jest.mock('../sandbox-docker', () => ({ buildSandboxedCommand: (p: { command: string; args: string[] }) => ({ sandboxed: false, command: p.command, args: p.args }) }));
jest.mock('../oauth-provider', () => ({ McpOAuthProvider: class {} }));
jest.mock('../../../security/ssrf-guard', () => ({ createPinnedFetch: () => fetch }));

import { ExternalMCPClient } from '../external-client';
import { extractNegotiationObservation } from '../negotiation-observer';
import { __resetPriorCacheForTest, MCP_NEGOTIATION_PROBE_TIMEOUT_MS } from '../protocol-negotiation';
import type { MCPServerConfig } from '../../../tool-contract/types';

jest.setTimeout(60_000);

const FIXTURES = path.join(__dirname, 'fixtures');
let tmp: string;
let logFile: string;

function serverCfg(id: string, fixture: string, env: Record<string, string> = {}): MCPServerConfig {
    return {
        id, name: id, transport_type: 'stdio',
        command: process.execPath, args: [path.join(FIXTURES, fixture)],
        env: { NEGOTIATION_FIXTURE_LOG: logFile, ...env },
        sandbox_network: 'full',
    } as unknown as MCPServerConfig;
}

function marks(): string[] {
    return fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8').split('\n').filter(Boolean) : [];
}
function count(kind: string): number {
    return marks().filter((m) => m === kind).length;
}

const opened: ExternalMCPClient[] = [];
async function connected(cfg: MCPServerConfig): Promise<ExternalMCPClient> {
    const c = new ExternalMCPClient(cfg);
    opened.push(c);
    await c.connect();
    return c;
}

beforeEach(() => {
    for (const k of Object.keys(settings)) delete settings[k];
    clientOpts.length = 0;
    connectArgs.length = 0;
    __resetPriorCacheForTest();
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp2-'));
    logFile = path.join(tmp, 'marks.log');
});

afterEach(async () => {
    await Promise.all(opened.splice(0).map((c) => c.disconnect()));
    fs.rmSync(tmp, { recursive: true, force: true });
});

describe('legacy(기본) — 종전 호출 그대로', () => {
    it.each([undefined, 'legacy', 'nonsense'])('MCP_PROTOCOL_NEGOTIATION=%s 면 협상 옵션 없이 connect(transport) 1인자', async (mode) => {
        settings.MCP_PROTOCOL_NEGOTIATION = mode;
        const c = await connected(serverCfg('legacy-off', 'negotiation-legacy-server.mjs'));
        expect(c.getStatus().status).toBe('connected');
        expect(clientOpts).toHaveLength(1);
        expect(Object.prototype.hasOwnProperty.call(clientOpts[0], 'versionNegotiation')).toBe(false);
        expect(connectArgs).toEqual([[expect.anything()]]);
        expect(count('spawn')).toBe(1);
        expect(c.getSdkClient()?.getProtocolEra()).toBe('legacy');
    });

    it('legacy 로 연결한 구 서버의 세대는 구별할 수 없다(v1-compatible)', async () => {
        const c = await connected(serverCfg('legacy-gen', 'negotiation-legacy-server.mjs'));
        expect(extractNegotiationObservation({ id: 'x', transport_type: 'stdio' }, c.getSdkClient()!, 'none', 'legacy').sdkGeneration).toBe('v1-compatible');
    });
});

describe('auto — 새 방식 우선, 구 서버 폴백', () => {
    beforeEach(() => { settings.MCP_PROTOCOL_NEGOTIATION = 'auto'; });

    it('Client 에 auto 협상 옵션(탐지 타임아웃 기본값)을 넘긴다', async () => {
        await connected(serverCfg('opt', 'negotiation-legacy-server.mjs'));
        expect(clientOpts[0]).toMatchObject({ versionNegotiation: { mode: 'auto', probe: { timeoutMs: MCP_NEGOTIATION_PROBE_TIMEOUT_MS, maxRetries: 0 } } });
    });

    it('구 서버(v1 SDK)는 탐지 후 initialize 로 폴백해 연결되고 도구를 부른다 — 세대 v1', async () => {
        const c = await connected(serverCfg('legacy-auto', 'negotiation-legacy-server.mjs'));
        const sdk = c.getSdkClient()!;
        expect(sdk.getProtocolEra()).toBe('legacy');
        expect(c.getTools().map((t) => t.name)).toEqual(['echo']);
        expect((await c.callTool('echo', {})).content[0]).toMatchObject({ text: 'legacy' });
        // 탐지용 형제 프로세스 1 + 세션 1
        expect(count('spawn')).toBe(2);
        expect(extractNegotiationObservation({ id: 'x', transport_type: 'stdio' }, sdk, 'none', 'auto').sdkGeneration).toBe('v1');
    });

    it('새 서버(server/discover 전용)는 새 방식으로 연결되고 도구를 부른다 — 세대 v2', async () => {
        const c = await connected(serverCfg('modern-auto', 'negotiation-modern-server.mjs'));
        const sdk = c.getSdkClient()!;
        expect(sdk.getProtocolEra()).toBe('modern');
        expect(sdk.getNegotiatedProtocolVersion()).toBe('2026-07-28');
        expect((await c.callTool('echo', {})).content[0]).toMatchObject({ text: 'modern' });
        expect(extractNegotiationObservation({ id: 'x', transport_type: 'stdio' }, sdk, 'none', 'auto').sdkGeneration).toBe('v2');
    });

    it('legacy 모드에서 새 방식 전용 서버는 종전처럼 연결되지 않는다(대조군)', async () => {
        settings.MCP_PROTOCOL_NEGOTIATION = 'legacy';
        const c = new ExternalMCPClient(serverCfg('modern-off', 'negotiation-modern-server.mjs'));
        opened.push(c);
        await expect(c.connect()).rejects.toThrow();
    });

    it.each([
        ['구 서버', 'negotiation-legacy-server.mjs', { kind: 'legacy' }],
        ['새 서버', 'negotiation-modern-server.mjs', { kind: 'modern' }],
    ])('재연결(%s)은 기억한 판정을 prior 로 넘겨 다시 탐지하지 않는다', async (_label, fixture, prior) => {
        const cfg = serverCfg(`re-${fixture}`, fixture);
        const c = await connected(cfg);
        const spawnsAfterFirst = count('spawn');
        const discoversAfterFirst = count('discover');
        await c.disconnect();

        await c.connect();
        expect(c.getStatus().status).toBe('connected');
        expect(connectArgs[1][1]).toMatchObject({ prior });
        // 재연결은 세션 프로세스 1개만 — 탐지용 형제 0
        expect(count('spawn') - spawnsAfterFirst).toBe(1);
        expect(count('discover') - discoversAfterFirst).toBe(0);
    });

    it('조용한 구 서버는 탐지 타임아웃 뒤 폴백 — 첫 연결 지연은 타임아웃 + 여유 안', async () => {
        settings.MCP_NEGOTIATION_PROBE_TIMEOUT_MS = '600';
        const started = Date.now();
        const c = await connected(serverCfg('silent', 'negotiation-legacy-server.mjs', { NEGOTIATION_FIXTURE_SILENT: '1' }));
        const elapsed = Date.now() - started;
        expect(c.getSdkClient()!.getProtocolEra()).toBe('legacy');
        expect(clientOpts[0]).toMatchObject({ versionNegotiation: { probe: { timeoutMs: 600 } } });
        expect(elapsed).toBeGreaterThanOrEqual(600);
        expect(elapsed).toBeLessThan(600 + 5_000);
    });

    it('연결이 실패하면 판정을 지워 다음 연결은 다시 탐지한다', async () => {
        const cfg = serverCfg('forget', 'negotiation-legacy-server.mjs');
        const c = await connected(cfg);
        await c.disconnect();
        // 다음 연결은 실패(없는 실행 파일) → 판정 삭제
        (cfg as { command: string }).command = path.join(tmp, 'missing-binary');
        await expect(c.connect()).rejects.toThrow();
        (cfg as { command: string }).command = process.execPath;
        await c.connect();
        expect(connectArgs[connectArgs.length - 1]).toHaveLength(1);
    });
});
