/**
 * 확장 번들 원격 MCP 관리 등록(P8) 판정 — URL(https·SSRF)·§8-3 MCP 서버 정책(실제 게이트, 조직 층·감사는 주입)·선언 URL 고정.
 * 네트워크 없음(DNS 는 주입).
 */
import {
    checkRemoteMcpUrl,
    checkRemoteMcpUrlStatic,
    checkExtensionRemoteMcp,
    checkMcpServerPolicyAtApproval,
    buildRemoteRegistrationMeta,
    readRemoteRegistration,
    verifyRemoteRegistrationUrl,
    type ExtensionRemoteMcpInput,
    type RemoteMcpPolicyDeps,
} from '../remote-mcp-registration';
import type { DnsResolver } from '../../../security/ssrf-guard';
import { resetConfig } from '../../../config/env';
import { resetExtensionMcpServerPolicyState } from '../mcp-server-policy';

const publicDns: DnsResolver = async () => ({ address: '93.184.216.34' });
const dnsTo = (address: string): DnsResolver => async () => ({ address });
const dnsFail: DnsResolver = async () => { throw new Error('getaddrinfo ENOTFOUND mcp.example.com'); };
const input = (over: Partial<ExtensionRemoteMcpInput> = {}): ExtensionRemoteMcpInput => ({
    phase: 'install', userId: 'u1', serverKey: 'cloud',
    transportType: 'streamable-http', url: 'https://mcp.example.com/mcp', ...over,
});

const POLICY_KEYS = ['EXTENSION_MCP_SERVER_POLICY_ENFORCED', 'EXTENSION_MCP_SERVER_POLICY'] as const;
const ORIGINAL_POLICY = Object.fromEntries(POLICY_KEYS.map(k => [k, process.env[k]]));
function setServerPolicy(enforced: boolean, policy?: object): void {
    if (enforced) process.env.EXTENSION_MCP_SERVER_POLICY_ENFORCED = 'true'; else delete process.env.EXTENSION_MCP_SERVER_POLICY_ENFORCED;
    if (policy) process.env.EXTENSION_MCP_SERVER_POLICY = JSON.stringify(policy); else delete process.env.EXTENSION_MCP_SERVER_POLICY;
    resetConfig();
}
const audit = jest.fn(async () => undefined);
const deps = (loadOrgLayer: RemoteMcpPolicyDeps['loadOrgLayer'] = async () => undefined): RemoteMcpPolicyDeps => ({ loadOrgLayer, audit });
afterEach(() => {
    for (const k of POLICY_KEYS) { if (ORIGINAL_POLICY[k] === undefined) delete process.env[k]; else process.env[k] = ORIGINAL_POLICY[k]; }
    resetConfig();
    resetExtensionMcpServerPolicyState();
    audit.mockClear();
});

describe('checkRemoteMcpUrl — https + SSRF', () => {
    it('공개 https 주소는 통과', async () => {
        expect(await checkRemoteMcpUrl('https://mcp.example.com/mcp', 'install', publicDns)).toEqual({ allowed: true });
    });

    it.each([
        ['http://mcp.example.com/mcp', 'MCP_REMOTE_URL_INSECURE'],
        ['ftp://mcp.example.com/mcp', 'MCP_REMOTE_URL_INSECURE'],
        ['not a url', 'MCP_REMOTE_URL_BLOCKED'],
        ['https://user:pass@mcp.example.com/mcp', 'MCP_REMOTE_URL_BLOCKED'],
    ])('정적 거절 %s → %s (DNS 를 부르지 않는다)', async (url, code) => {
        const resolver = jest.fn(publicDns);
        const r = await checkRemoteMcpUrl(url, 'install', resolver);
        expect(r).toMatchObject({ allowed: false, code });
        expect(resolver).not.toHaveBeenCalled();
        expect(checkRemoteMcpUrlStatic(url)).toMatchObject({ ok: false, code });
    });

    it.each(['127.0.0.1', '10.0.0.5', '192.168.1.10', '169.254.169.254', '::1'])('사설·루프백·메타데이터(%s)로 풀리면 차단', async (address) => {
        for (const phase of ['install', 'approve'] as const) {
            expect(await checkRemoteMcpUrl('https://mcp.example.com/mcp', phase, dnsTo(address)))
                .toMatchObject({ allowed: false, code: 'MCP_REMOTE_URL_BLOCKED' });
        }
    });

    it('호스트 확인 실패 — 설치는 경고로 통과(unresolved), 승인은 거절', async () => {
        expect(await checkRemoteMcpUrl('https://mcp.example.com/mcp', 'install', dnsFail)).toEqual({ allowed: true, unresolved: true });
        expect(await checkRemoteMcpUrl('https://mcp.example.com/mcp', 'approve', dnsFail))
            .toMatchObject({ allowed: false, code: 'MCP_REMOTE_URL_UNRESOLVED' });
    });
});

describe('§8-3 MCP 서버 정책 — 승인 시점 판정(실제 게이트)', () => {
    it('정책 강제 OFF 면 허용 — 정책 값이 있어도 판정·감사 없음(종전 동작)', async () => {
        setServerPolicy(false, { deny: [{ type: 'url', url: 'https://mcp.example.com' }] });
        expect(await checkMcpServerPolicyAtApproval(input({ phase: 'approve' }), deps())).toEqual({ allowed: true });
        expect(audit).not.toHaveBeenCalled();
    });

    it('전역 deny 에 걸리면 EXTENSION_MCP_SERVER_BLOCKED, 감사 origin=extension-approve', async () => {
        setServerPolicy(true, { deny: [{ type: 'url', url: 'https://mcp.example.com' }] });
        const r = await checkMcpServerPolicyAtApproval(input({ phase: 'approve' }), deps());
        expect(r).toMatchObject({ allowed: false, code: 'EXTENSION_MCP_SERVER_BLOCKED' });
        expect(audit).toHaveBeenCalledWith('u1', 'extension-approve', expect.objectContaining({ reason: 'DENIED', name: 'cloud' }));
    });

    it('조직 층 allow 밖이면 거절, 안이면 허용', async () => {
        setServerPolicy(true);
        const org = deps(async () => ({ allow: [{ type: 'url' as const, url: 'https://ok.example.com' }], deny: [], scope: 'organization' as const }));
        expect(await checkMcpServerPolicyAtApproval(input({ phase: 'approve' }), org)).toMatchObject({ allowed: false, code: 'EXTENSION_MCP_SERVER_BLOCKED' });
        expect(await checkMcpServerPolicyAtApproval(input({ phase: 'approve', url: 'https://ok.example.com/mcp' }), org)).toEqual({ allowed: true });
    });

    it('정책 조회 실패(적용 이력 없음)는 거절(fail-closed)', async () => {
        setServerPolicy(true);
        const failing = deps(async () => { throw new Error('policy store down'); });
        expect(await checkMcpServerPolicyAtApproval(input({ phase: 'approve' }), failing)).toMatchObject({ allowed: false, code: 'EXTENSION_MCP_SERVER_BLOCKED' });
    });

    it('checkExtensionRemoteMcp — URL 검사가 먼저, 정책은 승인 시점에만(설치는 collectMcpDrafts 게이트가 본다)', async () => {
        setServerPolicy(true, { deny: [{ type: 'url', url: 'https://mcp.example.com' }] });
        // URL 이 먼저 막히면 정책 판정(감사)은 없다
        expect(await checkExtensionRemoteMcp(input({ phase: 'approve' }), dnsTo('10.1.2.3'), deps())).toMatchObject({ code: 'MCP_REMOTE_URL_BLOCKED' });
        expect(audit).not.toHaveBeenCalled();
        // 설치 시점은 URL 만 — 정책 deny 여도 여기서는 통과(중복 감사 없음)
        expect(await checkExtensionRemoteMcp(input({ phase: 'install' }), dnsFail, deps())).toEqual({ allowed: true, unresolved: true });
        expect(audit).not.toHaveBeenCalled();
        // 승인 시점은 정책까지
        expect(await checkExtensionRemoteMcp(input({ phase: 'approve' }), publicDns, deps())).toMatchObject({ allowed: false, code: 'EXTENSION_MCP_SERVER_BLOCKED' });
        expect(audit).toHaveBeenCalledTimes(1);
    });
});

describe('선언 URL 고정', () => {
    it('기록을 만들고 읽는다 — 형태가 어긋나면 null', () => {
        const meta = buildRemoteRegistrationMeta('https://mcp.example.com/mcp', new Date('2026-11-28T00:00:00Z'));
        expect(readRemoteRegistration(meta)).toEqual({ declaredUrl: 'https://mcp.example.com/mcp', urlLocked: true, auth: 'oauth', registeredAt: '2026-11-28T00:00:00.000Z' });
        expect(readRemoteRegistration({})).toBeNull();
        expect(readRemoteRegistration({ remoteRegistration: { declaredUrl: 'x' } })).toBeNull();
        expect(readRemoteRegistration(null)).toBeNull();
    });

    it('저장 URL 이 선언값과 다르면 MISMATCH, 기록이 없으면(플래그 전 설치분) 통과', () => {
        const meta = buildRemoteRegistrationMeta('https://mcp.example.com/mcp');
        expect(verifyRemoteRegistrationUrl('https://mcp.example.com/mcp', meta)).toEqual({ allowed: true });
        expect(verifyRemoteRegistrationUrl('https://evil.example.net/mcp', meta)).toMatchObject({ allowed: false, code: 'MCP_REMOTE_URL_MISMATCH' });
        expect(verifyRemoteRegistrationUrl('https://anything/mcp', { source: 'extension' })).toEqual({ allowed: true });
    });
});
