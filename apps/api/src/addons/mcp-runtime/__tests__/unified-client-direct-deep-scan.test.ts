/**
 * E6(M-1) — 네임스페이스 외부 도구(`server::tool`)를 mcp_call 없이 직접 호출해도 중첩 인자까지 검사한다.
 * 차단은 isError + security.tool_args_blocked 감사(값 미기록), 실행기는 부르지 않는다.
 */
jest.mock('../../../services/AuditService', () => ({ getAuditService: () => ({ logAudit: jest.fn().mockResolvedValue(undefined) }) }));
jest.mock('../../../security/security-audit', () => ({
    ...jest.requireActual('../../../security/security-audit'),
    auditSecurityEvent: jest.fn().mockResolvedValue(undefined),
}));

import { UnifiedMCPClient } from '../unified-client';
import { auditSecurityEvent } from '../../../security/security-audit';
import type { MCPTool, MCPToolResult } from '../../../tool-contract/types';

const audit = auditSecurityEvent as jest.Mock;
const textOf = (r: MCPToolResult): string => r.content.map((c) => ('text' in c ? c.text : '')).join('');
const ctx = { userId: 'user-1', role: 'user' as const };
const run: MCPTool = { name: 'run', description: '실행', inputSchema: { type: 'object', properties: {} } };

describe('UnifiedMCPClient — 직접 server::tool 호출의 중첩 인자 검사', () => {
    const calls: Array<Record<string, unknown>> = [];
    let client: UnifiedMCPClient;
    beforeEach(() => {
        calls.length = 0;
        audit.mockClear();
        client = new UnifiedMCPClient();
        client.getToolRouter().registerExternalTools('srv-global', 'everything', [run], async (_name, args) => {
            calls.push(args);
            return { content: [{ type: 'text', text: 'ran' }] };
        });
    });

    it('중첩 객체 안의 위험 인자는 실행하지 않고 isError + 차단 감사', async () => {
        const r = await client.executeToolWithContext('everything::run', { opts: { command: 'rm -rf /; x' } }, ctx as never);
        expect(r.isError).toBe(true);
        expect(textOf(r)).toContain('차단된 도구 인자: opts.command');
        expect(textOf(r)).toContain('[shell]');
        expect(calls).toHaveLength(0);
        await new Promise((res) => setImmediate(res));
        expect(audit).toHaveBeenCalledTimes(1);
        expect(audit.mock.calls[0][0]).toMatchObject({ action: 'security.tool_args_blocked', resourceId: 'everything::run' });
        expect(JSON.stringify(audit.mock.calls[0][0])).not.toContain('rm -rf');
    });

    it('안전한 중첩 인자는 그대로 실행된다', async () => {
        const r = await client.executeToolWithContext('everything::run', { opts: { command: 'ls' } }, ctx as never);
        expect(r.isError).toBeFalsy();
        expect(calls).toEqual([{ opts: { command: 'ls' } }]);
    });
});
