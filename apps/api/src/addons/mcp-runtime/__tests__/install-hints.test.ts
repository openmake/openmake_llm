/** 설치 미리보기 MCP 안내 — add-on 판정(install-hints)과 Base 포트(등록 없음·실패 fail-open). */
import { mcpInstallHints } from '../install-hints';
import { getMcpInstallHints, registerMcpInstallHints } from '../../../runtime-ports/mcp-install-hints';

describe('mcpInstallHints', () => {
    it('stdio 는 안내 없음', () => {
        expect(mcpInstallHints({ name: 'a', transportType: 'stdio', command: 'npx' })).toEqual([]);
    });
    it('원격 HTTP 는 로그인 안내', () => {
        expect(mcpInstallHints({ name: 'a', transportType: 'streamable-http', url: 'https://mcp.example.invalid/mcp' }))
            .toEqual([{ code: 'remote-auth-may-be-required' }]);
    });
    it('알려진 이동 엔드포인트는 MCP-3 규칙표 그대로 + 로그인 안내', () => {
        const hints = mcpInstallHints({ name: 'atl', transportType: 'streamable-http', url: 'https://mcp.atlassian.com/v1/mcp' });
        expect(hints[0]).toEqual({
            code: 'endpoint-moved',
            detail: { replacementUrl: 'https://mcp.atlassian.com/v2/mcp', replacementVerified: true, sunsetDate: '2027-03-01', reauthRequired: true },
        });
        expect(hints[1]).toEqual({ code: 'remote-auth-may-be-required' });
    });
    it('SSE 는 퇴역 전송 안내(관례 후보 주소)', () => {
        expect(mcpInstallHints({ name: 's', transportType: 'sse', url: 'https://x.example.invalid/sse' })[0])
            .toMatchObject({ code: 'deprecated-transport', detail: { replacementUrl: 'https://x.example.invalid/mcp', replacementVerified: false } });
    });
});

describe('runtime-ports/mcp-install-hints', () => {
    it('등록이 없으면 빈 목록, 등록하면 판정, 실패하면 빈 목록(fail-open), 해제 후 다시 빈 목록', () => {
        const entry = { name: 'a', transportType: 'streamable-http', url: 'https://mcp.example.invalid/mcp' };
        expect(getMcpInstallHints(entry)).toEqual([]);
        const off = registerMcpInstallHints(mcpInstallHints);
        expect(getMcpInstallHints(entry)).toEqual([{ code: 'remote-auth-may-be-required' }]);
        off();
        const offBad = registerMcpInstallHints(() => { throw new Error('boom'); });
        expect(getMcpInstallHints(entry)).toEqual([]);
        offBad();
        expect(getMcpInstallHints(entry)).toEqual([]);
    });
});
