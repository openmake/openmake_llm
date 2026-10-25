/**
 * mcp_call — 안쪽 도구도 Base 보안 실행기(executeToolSecurely)를 거친다(E6).
 * 바깥 mcp_call 호출의 검사는 args 객체 안을 보지 않으므로, 핸들러가 안쪽 실행을 보안 실행기로 감싸고
 * 중첩 인자까지 검사한다. 차단은 isError + security.tool_args_blocked 감사(값 미기록).
 */
jest.mock('../../../services/AuditService', () => ({ getAuditService: () => ({ logAudit: jest.fn().mockResolvedValue(undefined) }) }));
jest.mock('../../../security/security-audit', () => ({
    ...jest.requireActual('../../../security/security-audit'),
    auditSecurityEvent: jest.fn().mockResolvedValue(undefined),
}));

import { ToolRouter } from '../tool-router';
import { mcpMetaTools } from '../mcp-meta-tools';
import { auditSecurityEvent } from '../../../security/security-audit';
import { UserSandbox } from '../../../tool-contract/user-sandbox';
import type { MCPTool, MCPToolResult } from '../../../tool-contract/types';

let router: ToolRouter;
jest.mock('../unified-client', () => ({ getUnifiedMCPClient: () => ({ getToolRouter: () => router }) }));

const audit = auditSecurityEvent as jest.Mock;
const mcpCall = mcpMetaTools.find((t) => t.tool.name === 'mcp_call')!.handler;
const textOf = (r: MCPToolResult): string => r.content.map((c) => ('text' in c ? c.text : '')).join('');
const ctx = { userId: 'user-1', role: 'user' as const };
const run: MCPTool = { name: 'run', description: '실행', inputSchema: { type: 'object', properties: {} } };

describe('mcp_call × 안쪽 도구 보안 실행', () => {
    const calls: Array<Record<string, unknown>> = [];
    beforeEach(() => {
        calls.length = 0;
        audit.mockClear();
        router = new ToolRouter();
        router.registerExternalTools('srv-global', 'everything', [run], async (_name, args) => {
            calls.push(args);
            return { content: [{ type: 'text', text: 'ran' }] };
        });
    });

    it('중첩 객체·배열 안의 위험 인자는 실행하지 않고 isError + 차단 감사', async () => {
        const r = await mcpCall({ server: 'everything', tool: 'run', args: { opts: { steps: [{ command: 'ls; rm -rf /' }] } } }, ctx);
        expect(r.isError).toBe(true);
        expect(textOf(r)).toContain('차단된 도구 인자: opts.steps[0].command');
        expect(textOf(r)).toContain('[shell]');
        expect(textOf(r)).not.toContain('rm -rf');
        expect(calls).toHaveLength(0);
        await new Promise((res) => setImmediate(res));
        expect(audit).toHaveBeenCalledTimes(1);
        const input = audit.mock.calls[0][0];
        expect(input).toMatchObject({ action: 'security.tool_args_blocked', userId: 'user-1', resourceType: 'mcp_external_tool', resourceId: 'everything::run' });
        expect(input.details).toMatchObject({ reason: 'shell', key: 'opts.steps[0].command' });
        expect(JSON.stringify(input)).not.toContain('rm -rf');
    });

    it('깊이 상한을 넘는 중첩 인자는 막는다(fail-closed)', async () => {
        let deep: unknown = 'hello';
        for (let i = 0; i < 20; i++) deep = { n: deep };
        const r = await mcpCall({ server: 'everything', tool: 'run', args: { deep } }, ctx);
        expect(r.isError).toBe(true);
        expect(textOf(r)).toContain('[depth]');
        expect(calls).toHaveLength(0);
    });

    it('args 최상위의 위험 인자도 차단한다', async () => {
        const r = await mcpCall({ server: 'everything', tool: 'run', args: { cmd: 'a && b' } }, ctx);
        expect(r.isError).toBe(true);
        expect(textOf(r)).toContain('차단된 도구 인자: cmd');
        expect(calls).toHaveLength(0);
    });

    it('안쪽 도구의 경로 인자도 사용자 샌드박스로 바꾸고, 밖을 가리키면 막는다', async () => {
        const resolve = jest.spyOn(UserSandbox, 'resolvePath')
            .mockImplementation((_u, p) => (p.startsWith('/') ? null : `/sandbox/user-1/workspace/${p}`));
        try {
            const ok = await mcpCall({ server: 'everything', tool: 'run', args: { path: 'notes.txt' } }, ctx);
            expect(textOf(ok)).toBe('ran');
            expect(resolve).toHaveBeenCalledWith('user-1', 'notes.txt');
            expect(calls[0].path).toBe('/sandbox/user-1/workspace/notes.txt');

            const out = await mcpCall({ server: 'everything', tool: 'run', args: { path: '/etc/hosts' } }, ctx);
            expect(out.isError).toBe(true);
            expect(textOf(out)).toContain('차단된 경로 인자: path');
            expect(calls).toHaveLength(1);
        } finally {
            resolve.mockRestore();
        }
    });

    it('위험 패턴이 없는 중첩 인자는 그대로 실행한다', async () => {
        const args = { opts: { steps: [{ command: 'ls -la' }], note: 'hello' } };
        const r = await mcpCall({ server: 'everything', tool: 'run', args }, ctx);
        expect(textOf(r)).toBe('ran');
        expect(calls).toEqual([args]);
    });
});
