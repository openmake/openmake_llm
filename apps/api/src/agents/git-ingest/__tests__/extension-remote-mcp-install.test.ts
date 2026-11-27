/**
 * 확장 번들 원격 MCP 관리 등록(P8, opt-in EXTENSION_REMOTE_MCP_ENABLED) — 설치 단계.
 *
 *  - 플래그 OFF: 종전 그대로(원격 서버도 URL 검사 없이 draft, 관리 기록 없음, DNS 조회 없음)
 *  - 플래그 ON: https·SSRF 가드 통과분만 draft 로 저장하고 선언 URL 을 manifest_meta.remoteRegistration 에 고정한다
 *  - MCP 서버 정책(§8-3, EXTENSION_MCP_SERVER_POLICY_ENFORCED)은 루프 머리의 게이트가 판정한다 — 정책에 막힌 원격 서버는
 *    URL 검사(DNS)도 저장도 없이 빠지고, 통과한 서버만 관리 등록된다(실제 정책 함수로 검증)
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

const resolveEffectivePolicyStrict = jest.fn(async () => ({ extensionMcpServer: undefined }));
jest.mock('../../../services/org/effective-policy', () => ({
    ...jest.requireActual('../../../services/org/effective-policy'),
    resolveEffectivePolicyStrict: () => resolveEffectivePolicyStrict(),
}));
const logAudit = jest.fn(async (_e: unknown) => undefined);
jest.mock('../../../services/AuditService', () => ({ getAuditService: () => ({ logAudit: (e: unknown) => logAudit(e) }) }));

import { collectMcpDrafts, type ComponentContext } from '../extension-components';
import type { LLMClient } from '../../../llm/client';
import { resetConfig } from '../../../config/env';
import { resetExtensionMcpServerPolicyState } from '../../../services/extensions/mcp-server-policy';

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
const ENV_KEYS = ['EXTENSION_REMOTE_MCP_ENABLED', 'EXTENSION_MCP_SERVER_POLICY_ENFORCED', 'EXTENSION_MCP_SERVER_POLICY'] as const;
const ORIGINAL_ENV = Object.fromEntries(ENV_KEYS.map(k => [k, process.env[k]]));
function setFlag(on: boolean | undefined): void {
    if (on === undefined) delete process.env.EXTENSION_REMOTE_MCP_ENABLED;
    else process.env.EXTENSION_REMOTE_MCP_ENABLED = on ? 'true' : 'false';
    resetConfig();
}
function setServerPolicy(policy: object | undefined): void {
    if (policy === undefined) { delete process.env.EXTENSION_MCP_SERVER_POLICY_ENFORCED; delete process.env.EXTENSION_MCP_SERVER_POLICY; }
    else { process.env.EXTENSION_MCP_SERVER_POLICY_ENFORCED = 'true'; process.env.EXTENSION_MCP_SERVER_POLICY = JSON.stringify(policy); }
    resetConfig();
}

beforeEach(() => {
    insertDraft.mockReset();
    insertDraft.mockImplementation(async (input: { name: string }) => ({ id: `id-${input.name}` }));
    mockValidate.mockClear();
});
afterEach(() => { setServerPolicy(undefined); resetExtensionMcpServerPolicyState(); logAudit.mockClear(); });
afterAll(() => {
    for (const k of ENV_KEYS) { if (ORIGINAL_ENV[k] === undefined) delete process.env[k]; else process.env[k] = ORIGINAL_ENV[k]; }
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

    it('§8-3 정책 연결 — 정책이 막은 원격 서버는 URL 검사·저장 없이 빠지고, 허용 서버만 관리 등록된다', async () => {
        setFlag(true);
        setServerPolicy({ deny: [{ type: 'url', url: 'https://blocked.example.com' }] });
        const banned = { name: 'banned', transportType: 'streamable-http' as const, url: 'https://blocked.example.com/mcp' };
        const c = ctx(['network:internet']);
        const res = await collectMcpDrafts(c, [banned, remote], llm);

        expect(res.find(r => r.name === 'banned')?.error).toMatch(/^EXTENSION_MCP_SERVER_BLOCKED/);
        expect(c.warnings.join('\n')).toContain("MCP_SERVER_POLICY_BLOCKED: MCP 서버 'banned' 제외");
        expect(mockValidate.mock.calls.map(call => call[0])).toEqual(['https://mcp.example.com/mcp']);
        expect(insertDraft).toHaveBeenCalledTimes(1);
        expect(insertDraft.mock.calls[0][0].manifestMeta.remoteRegistration).toMatchObject({ declaredUrl: 'https://mcp.example.com/mcp' });
        // 거절은 감사에 한 번만 남는다(설치 게이트 한 곳)
        expect(logAudit).toHaveBeenCalledTimes(1);
        expect(logAudit.mock.calls[0][0]).toMatchObject({ action: 'extension.mcp_server_blocked', details: { origin: 'extension-install' } });
    });

    it('§8-3 정책 강제 OFF 면 정책 값이 있어도 판정하지 않는다(종전 동작)', async () => {
        setFlag(true);
        process.env.EXTENSION_MCP_SERVER_POLICY = JSON.stringify({ deny: [{ type: 'url', url: 'https://mcp.example.com' }] });
        resetConfig();
        const c = ctx(['network:internet']);
        const res = await collectMcpDrafts(c, [remote], llm);
        expect(res[0].error).toBeUndefined();
        expect(insertDraft).toHaveBeenCalledTimes(1);
        expect(logAudit).not.toHaveBeenCalled();
    });
});
