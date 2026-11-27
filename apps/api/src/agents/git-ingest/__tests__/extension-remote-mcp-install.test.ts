/**
 * 확장 번들 원격 MCP 관리 등록(P8, opt-in EXTENSION_REMOTE_MCP_ENABLED) — 설치 단계.
 *
 *  - 플래그 OFF: 종전 그대로(원격 서버도 URL 검사 없이 draft, 관리 기록 없음, DNS 조회 없음)
 *  - 플래그 ON: https·SSRF 가드 통과분만 draft 로 저장하고 선언 URL 을 manifest_meta.remoteRegistration 에 고정한다
 *  - MCP 서버 정책 훅(§8-3 자리)은 플래그와 무관하게 불리고, 등록이 없으면 아무 것도 바꾸지 않는다
 */
const insertDraft = jest.fn();
jest.mock('../../../addons/mcp-runtime/data/mcp-server-draft-repository', () => ({
    McpServerDraftRepository: jest.fn().mockImplementation(() => ({ insertDraft })),
}));
jest.mock('../convention-checker', () => ({
    ConventionChecker: jest.fn().mockImplementation(() => ({
        checkMcpServer: async () => ({ findings: [], tokensUsed: 0 }),
    })),
    isBlockedByConvention: () => false,
}));
// DNS 없이 SSRF 판정을 흉내 낸다 — internal.* 는 사설 주소로 풀린다고 본다
const mockValidate = jest.fn(async (raw: string) => {
    const u = new URL(raw);
    if (u.hostname.startsWith('internal.')) throw new Error('SSRF blocked: resolved to blocked IP range: 10.0.0.5');
    if (u.hostname.startsWith('offline.')) throw new Error(`getaddrinfo ENOTFOUND ${u.hostname}`);
    return u;
});
jest.mock('../../../security/ssrf-guard', () => ({
    ...jest.requireActual('../../../security/ssrf-guard'),
    validateOutboundUrl: (raw: string) => mockValidate(raw),
}));

import { collectMcpDrafts, type ComponentContext } from '../extension-components';
import type { LLMClient } from '../../../llm/client';
import { resetConfig } from '../../../config/env';
import { setExtensionMcpServerPolicyHook } from '../../../services/extensions/remote-mcp-registration';

const stdio = { name: 'local', transportType: 'stdio' as const, command: 'npx', args: ['-y', 'some-mcp@1.0.0'] };
const remote = { name: 'cloud', transportType: 'streamable-http' as const, url: 'https://mcp.example.com/mcp' };
const plain = { name: 'plain', transportType: 'streamable-http' as const, url: 'http://mcp.example.com/mcp' };
const internal = { name: 'intra', transportType: 'streamable-http' as const, url: 'https://internal.corp/mcp' };
const offline = { name: 'later', transportType: 'streamable-http' as const, url: 'https://offline.example.com/mcp' };

function ctx(addonPermissions?: readonly string[]): ComponentContext {
    return {
        pool: { query: async () => ({ rows: [], rowCount: 0 }) } as never,
        fetcher: {} as never, owner: 'o', repo: 'r', sha: 's',
        tree: { entries: [] } as never, root: '',
        userId: 'u1', isAdmin: false, gitUrl: 'https://github.com/o/r',
        manifestPath: 'plugin.json', extensionName: 'ext', warnings: [],
        ...(addonPermissions !== undefined ? { addonPermissions } : {}),
    };
}
const llm = (() => ({})) as unknown as (model: string) => LLMClient;
const ORIGINAL = process.env.EXTENSION_REMOTE_MCP_ENABLED;
function setFlag(on: boolean | undefined): void {
    if (on === undefined) delete process.env.EXTENSION_REMOTE_MCP_ENABLED;
    else process.env.EXTENSION_REMOTE_MCP_ENABLED = on ? 'true' : 'false';
    resetConfig();
}

beforeEach(() => {
    insertDraft.mockReset();
    insertDraft.mockImplementation(async (input: { name: string }) => ({ id: `id-${input.name}` }));
    mockValidate.mockClear();
});
afterEach(() => setExtensionMcpServerPolicyHook(null));
afterAll(() => {
    if (ORIGINAL === undefined) delete process.env.EXTENSION_REMOTE_MCP_ENABLED;
    else process.env.EXTENSION_REMOTE_MCP_ENABLED = ORIGINAL;
    resetConfig();
});

describe('collectMcpDrafts — 원격 MCP 관리 등록', () => {
    it('플래그 OFF(기본) — 종전 그대로: 평문·내부 주소도 draft, 관리 기록·DNS 조회 없음', async () => {
        setFlag(undefined);
        const c = ctx(['network:internet']);
        const res = await collectMcpDrafts(c, [stdio, remote, plain, internal], llm);
        expect(res.filter(r => r.error)).toEqual([]);
        expect(insertDraft).toHaveBeenCalledTimes(4);
        for (const call of insertDraft.mock.calls) expect(call[0].manifestMeta).not.toHaveProperty('remoteRegistration');
        expect(insertDraft.mock.calls.find(c2 => c2[0].transportType !== 'stdio')![0].url).toBe('https://mcp.example.com/mcp');
        expect(mockValidate).not.toHaveBeenCalled();
        expect(c.warnings.join(' ')).not.toMatch(/MCP_REMOTE_URL_/);
    });

    it('플래그 ON — https·SSRF 통과분만 저장, 선언 URL 고정, stdio 는 무변경', async () => {
        setFlag(true);
        const c = ctx(['network:internet']);
        const res = await collectMcpDrafts(c, [stdio, remote, plain, internal, offline], llm);

        const saved = insertDraft.mock.calls.map(call => call[0]);
        expect(saved.map(s => s.transportType === 'stdio' ? 'stdio' : s.url)).toEqual(['stdio', 'https://mcp.example.com/mcp', 'https://offline.example.com/mcp']);
        const cloud = saved.find(s => s.url === 'https://mcp.example.com/mcp')!;
        expect(cloud.manifestMeta.remoteRegistration).toMatchObject({ declaredUrl: 'https://mcp.example.com/mcp', urlLocked: true, auth: 'oauth' });
        expect(saved.find(s => s.transportType === 'stdio')!.manifestMeta).not.toHaveProperty('remoteRegistration');

        expect(res.find(r => r.name === 'plain')?.error).toMatch(/^MCP_REMOTE_URL_INSECURE/);
        expect(res.find(r => r.name === 'intra')?.error).toMatch(/^MCP_REMOTE_URL_BLOCKED/);
        const w = c.warnings.join('\n');
        expect(w).toContain("MCP_REMOTE_URL_INSECURE: MCP 서버 'plain' 제외");
        expect(w).toContain("MCP_REMOTE_URL_BLOCKED: MCP 서버 'intra' 제외");
        // 호스트를 못 찾은 서버는 저장하되 승인 때 다시 본다고 안내한다
        expect(w).toContain("MCP_REMOTE_URL_UNRESOLVED: 원격 MCP 서버 'later'");
    });

    it('플래그 ON 이어도 network:internet 권한이 없으면 종전처럼 권한 사유로 제외(검사 이전)', async () => {
        setFlag(true);
        const c = ctx([]);
        const res = await collectMcpDrafts(c, [remote], llm);
        expect(res[0].error).toMatch(/^PERMISSION_DENIED/);
        expect(mockValidate).not.toHaveBeenCalled();
    });

    it('정책 훅(§8-3 자리) — 플래그와 무관하게 원격·stdio 를 받고, 거절하면 제외', async () => {
        setFlag(undefined);
        const hook = jest.fn((i: { serverKey?: string }) => (i.serverKey === 'local'
            ? { allowed: false as const, reason: '명령 허용 목록 밖' } : { allowed: true as const }));
        setExtensionMcpServerPolicyHook(hook);
        const c = ctx(undefined);
        const res = await collectMcpDrafts(c, [stdio, remote], llm);
        expect(hook).toHaveBeenCalledTimes(2);
        expect(hook.mock.calls[0][0]).toMatchObject({ phase: 'install', transportType: 'stdio', command: 'npx', extensionName: 'ext', sourceUrl: 'https://github.com/o/r' });
        expect(res.find(r => r.name === 'local')?.error).toMatch(/^MCP_SERVER_POLICY_BLOCKED/);
        expect(insertDraft).toHaveBeenCalledTimes(1);
    });
});
