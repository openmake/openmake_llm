/**
 * 확장 번들 원격 MCP 관리 등록(P8) 판정 — URL(https·SSRF)·정책 훅(§8-3 자리)·선언 URL 고정. 네트워크 없음(DNS 는 주입).
 */
import {
    checkRemoteMcpUrl,
    checkRemoteMcpUrlStatic,
    checkExtensionRemoteMcp,
    checkExtensionMcpServerPolicy,
    setExtensionMcpServerPolicyHook,
    buildRemoteRegistrationMeta,
    readRemoteRegistration,
    verifyRemoteRegistrationUrl,
    type ExtensionMcpServerPolicyInput,
} from '../remote-mcp-registration';
import type { DnsResolver } from '../../../security/ssrf-guard';

const publicDns: DnsResolver = async () => ({ address: '93.184.216.34' });
const dnsTo = (address: string): DnsResolver => async () => ({ address });
const dnsFail: DnsResolver = async () => { throw new Error('getaddrinfo ENOTFOUND mcp.example.com'); };
const input = (over: Partial<ExtensionMcpServerPolicyInput> = {}): ExtensionMcpServerPolicyInput => ({
    phase: 'install', userId: 'u1', extensionName: 'pack', serverKey: 'cloud',
    transportType: 'streamable-http', url: 'https://mcp.example.com/mcp', ...over,
});

afterEach(() => setExtensionMcpServerPolicyHook(null));

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

describe('MCP 서버 정책 훅 — §8-3 자리', () => {
    it('등록이 없으면 언제나 허용', async () => {
        expect(await checkExtensionMcpServerPolicy(input({ transportType: 'stdio', url: null, command: 'npx' }))).toEqual({ allowed: true });
    });

    it('훅이 거절하면 POLICY_BLOCKED, 입력(원격·stdio 구분 포함)을 그대로 받는다', async () => {
        const hook = jest.fn(async () => ({ allowed: false as const, reason: '허용 목록 밖' }));
        setExtensionMcpServerPolicyHook(hook);
        expect(await checkExtensionMcpServerPolicy(input())).toMatchObject({ allowed: false, code: 'MCP_SERVER_POLICY_BLOCKED', reason: '허용 목록 밖' });
        expect(hook).toHaveBeenCalledWith(expect.objectContaining({ phase: 'install', transportType: 'streamable-http', url: 'https://mcp.example.com/mcp' }));
    });

    it('훅이 실패하면 거절(fail-closed)', async () => {
        setExtensionMcpServerPolicyHook(() => { throw new Error('policy store down'); });
        expect(await checkExtensionMcpServerPolicy(input())).toMatchObject({ allowed: false, code: 'MCP_SERVER_POLICY_UNAVAILABLE' });
    });

    it('checkExtensionRemoteMcp — URL 검사가 먼저, 통과해야 정책을 본다', async () => {
        const hook = jest.fn(() => ({ allowed: true as const }));
        setExtensionMcpServerPolicyHook(hook);
        expect(await checkExtensionRemoteMcp(input({ url: 'https://mcp.example.com/mcp' }), dnsTo('10.1.2.3'))).toMatchObject({ code: 'MCP_REMOTE_URL_BLOCKED' });
        expect(hook).not.toHaveBeenCalled();
        expect(await checkExtensionRemoteMcp(input(), dnsFail)).toEqual({ allowed: true, unresolved: true });
        expect(hook).toHaveBeenCalledTimes(1);
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
