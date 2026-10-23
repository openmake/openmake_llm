/**
 * 도구 인자 차단 감사(S10) — 샌드박스 경로 위반·위험 인자 차단을 security.tool_args_blocked 로 남긴다.
 * 인자 값은 남기지 않는다(키 이름·사유·인자 해시만). 차단 응답(isError 결과)은 종전 그대로.
 */
const logAudit = jest.fn().mockResolvedValue(undefined);
jest.mock('../../services/AuditService', () => ({ getAuditService: () => ({ logAudit }) }));
jest.mock('../../security/security-audit', () => ({
    ...jest.requireActual('../../security/security-audit'),
    auditSecurityEvent: jest.fn().mockResolvedValue(undefined),
}));

import { executeToolSecurely } from '../tool-execution-guard';
import { auditSecurityEvent } from '../../security/security-audit';
import type { UserContext } from '../types';

const audit = auditSecurityEvent as jest.Mock;
const ctx: UserContext = { userId: 'u-9', role: 'user' };
const ok = jest.fn().mockResolvedValue({ content: [{ type: 'text', text: 'ok' }] });

describe('executeToolSecurely × 인자 차단 감사', () => {
    beforeEach(() => { audit.mockClear(); ok.mockClear(); logAudit.mockClear(); });

    it('위험 인자(shell) 차단 → isError + security.tool_args_blocked 1회, 값·인자 원문 없음', async () => {
        const result = await executeToolSecurely(ok, 'run_cmd', { cmd: 'rm -rf /; ' }, ctx);
        expect(result.isError).toBe(true);
        expect(result.content[0].text).toContain('차단된 도구 인자: cmd');
        expect(ok).not.toHaveBeenCalled();
        await new Promise((r) => setImmediate(r));
        expect(audit).toHaveBeenCalledTimes(1);
        const input = audit.mock.calls[0][0];
        expect(input).toMatchObject({
            action: 'security.tool_args_blocked', userId: 'u-9', resourceType: 'mcp_builtin_tool', resourceId: 'run_cmd',
        });
        expect(input.details).toMatchObject({ reason: 'shell', key: 'cmd', role: 'user' });
        expect(input.details.argsHash).toMatch(/^[0-9a-f]{64}$/);
        expect(input.details).not.toHaveProperty('value');
        expect(input.details).not.toHaveProperty('args');
        expect(JSON.stringify(input)).not.toContain('rm -rf');
    });

    it('샌드박스 경로 위반 → reason sandbox-path, 외부 도구는 mcp_external_tool', async () => {
        const result = await executeToolSecurely(ok, 'fs::read', { path: '/etc/passwd' }, ctx);
        expect(result.isError).toBe(true);
        await new Promise((r) => setImmediate(r));
        expect(audit).toHaveBeenCalledTimes(1);
        const input = audit.mock.calls[0][0];
        expect(input).toMatchObject({ resourceType: 'mcp_external_tool', resourceId: 'fs::read' });
        expect(input.details).toMatchObject({ reason: 'sandbox-path', key: 'path' });
        expect(input.details.argsHash).toMatch(/^[0-9a-f]{64}$/);
        expect(input.details).not.toHaveProperty('value');
        expect(input.details).not.toHaveProperty('args');
        expect(JSON.stringify(input)).not.toContain('/etc/passwd');
    });

    it('순환 참조 인자도 isError 결과 그대로, 해시는 unhashable 로 남긴다', async () => {
        const args: Record<string, unknown> = { cmd: 'rm -rf /; ' };
        args.self = args;
        const result = await executeToolSecurely(ok, 'run_cmd', args, ctx);
        expect(result.isError).toBe(true);
        expect(result.content[0].text).toContain('차단된 도구 인자: cmd');
        await new Promise((r) => setImmediate(r));
        expect(audit).toHaveBeenCalledTimes(1);
        expect(audit.mock.calls[0][0].details.argsHash).toBe('unhashable');
    });

    it('정상 인자 → 감사 0회(차단 감사 기준)', async () => {
        const result = await executeToolSecurely(ok, 'web_search', { query: 'hello world' }, ctx);
        expect(result.isError).toBeUndefined();
        await new Promise((r) => setImmediate(r));
        expect(audit).not.toHaveBeenCalled();
    });
});

describe('executeToolSecurely × 호출 감사(mcp_tool_call) actor', () => {
    beforeEach(() => { ok.mockClear(); logAudit.mockClear(); });

    const callAudit = async (userId: unknown) => {
        await executeToolSecurely(ok, 'web_search', { query: 'hello' }, { userId, role: 'user' } as unknown as UserContext);
        await new Promise((r) => setImmediate(r));
        expect(logAudit).toHaveBeenCalledTimes(1);
        return logAudit.mock.calls[0][0] as { userId?: string; details: Record<string, unknown> };
    };

    it("손님('guest')·빈값·없음은 user_id 없이 actorId 'anonymous'(#1476)", async () => {
        for (const uid of ['guest', '', undefined, null]) {
            logAudit.mockClear();
            const e = await callAudit(uid);
            expect(e.userId).toBeUndefined();
            expect(e.details.actorId).toBe('anonymous');
        }
    });

    it('실제 사용자 id 는 user_id·actorId 에 그대로 남는다', async () => {
        const e = await callAudit('u-9');
        expect(e.userId).toBe('u-9');
        expect(e.details.actorId).toBe('u-9');
        const n = await (async () => { logAudit.mockClear(); return callAudit(42); })();
        expect(n.userId).toBe('42');
        expect(n.details.actorId).toBe('42');
    });
});
