/**
 * 도구 호출 감사의 판정 근거(하네스 P2 감사 무결성) — mcp_tool_call 감사 행 details 에 인자 해시·위험 등급·승인 정책·작업 id 를 싣는다.
 * 인자 원문은 넣지 않고, 해시는 승인 저장소(args_hash)와 같은 hashToolArgs 라 출처 간 같은 호출을 맞출 수 있다.
 */
const logAudit = jest.fn().mockResolvedValue(undefined);
jest.mock('../../services/AuditService', () => ({ getAuditService: () => ({ logAudit }) }));

import { executeToolSecurely, toolCallPolicyBasis } from '../tool-execution-guard';
import { hashToolArgs } from '../../utils/args-hash';
import { classifyToolRisk } from '../../config/tool-policy';
import type { UserContext } from '../types';

const ok = jest.fn().mockResolvedValue({ content: [{ type: 'text', text: 'ok' }] });
const flush = (): Promise<void> => new Promise((r) => setImmediate(r));

describe('도구 호출 감사 × 판정 근거', () => {
    beforeEach(() => { logAudit.mockClear(); ok.mockClear(); });

    it('작업 문맥이면 taskId·approvalPolicy·riskClass·argsHash 가 details 에 실리고 인자 원문은 없다', async () => {
        const ctx: UserContext = { userId: 'u-1', role: 'user', auditTaskId: 'task-abc', approvalPolicy: 'high-risk' };
        const args = { query: 'secret-query-value' };
        await executeToolSecurely(ok, 'web_search', args, ctx);
        await flush();
        expect(logAudit).toHaveBeenCalledTimes(1);
        const input = logAudit.mock.calls[0][0];
        expect(input.action).toBe('mcp_tool_call');
        expect(input.details).toMatchObject({
            taskId: 'task-abc', approvalPolicy: 'high-risk', argsHash: hashToolArgs(args), riskClass: classifyToolRisk('web_search', args),
        });
        expect(JSON.stringify(input)).not.toContain('secret-query-value');
    });

    it('채팅 문맥(작업 아님)이면 taskId·approvalPolicy 는 없고 해시·등급만 남는다', () => {
        const basis = toolCallPolicyBasis('web_search', { query: 'x' }, { userId: 'u', role: 'user' });
        expect(basis).not.toHaveProperty('taskId');
        expect(basis).not.toHaveProperty('approvalPolicy');
        expect(basis.argsHash).toMatch(/^[0-9a-f]{64}$/);
        expect(typeof basis.riskClass).toBe('string');
    });

    it('반출 관문이 내부 전용으로 판정한 문맥은 egressInternalOnly 를 남긴다', () => {
        expect(toolCallPolicyBasis('web_search', {}, { userId: 'u', role: 'user', egressInternalOnly: true }).egressInternalOnly).toBe(true);
    });

    it('해시할 수 없는 인자(순환)도 감사는 남는다 — argsHash=unhashable', () => {
        const args: Record<string, unknown> = { a: 1 };
        args.self = args;
        expect(toolCallPolicyBasis('web_search', args, { userId: 'u', role: 'user' }).argsHash).toBe('unhashable');
    });

    it('근거는 실행 전 인자 기준 — 도구가 args 를 고쳐도 해시는 받은 값', async () => {
        const mutating = jest.fn(async (_n: string, a: Record<string, unknown>) => { a.query = 'changed'; return { content: [{ type: 'text' as const, text: 'ok' }] }; });
        await executeToolSecurely(mutating, 'web_search', { query: 'original' }, { userId: 'u', role: 'user' });
        await flush();
        expect(logAudit.mock.calls[0][0].details.argsHash).toBe(hashToolArgs({ query: 'original' }));
    });
});
