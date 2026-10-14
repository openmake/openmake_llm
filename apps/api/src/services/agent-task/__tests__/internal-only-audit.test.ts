/**
 * 내부 전용 실행의 감사 기록(auditInternalOnly) — 차단한 것이 있을 때만 남기고, 기록 실패는 삼킨다(fail-open).
 */
const logAudit = jest.fn(async (_entry: unknown) => undefined);
const getAuditService = jest.fn(() => ({ logAudit }));
jest.mock('../../AuditService', () => ({ getAuditService: () => getAuditService() }));
const warn = jest.fn();
jest.mock('../../../utils/logger', () => ({
    createLogger: () => ({ debug: jest.fn(), info: jest.fn(), warn: (m: string) => warn(m), error: jest.fn() }),
}));

import { auditInternalOnly, INTERNAL_ONLY_AUDIT_ACTION } from '../internal-only-audit';

beforeEach(() => {
    jest.clearAllMocks();
    logAudit.mockImplementation(async () => undefined);
    getAuditService.mockImplementation(() => ({ logAudit }));
});

const entry = (): Record<string, unknown> => logAudit.mock.calls[0][0] as Record<string, unknown>;

describe('auditInternalOnly', () => {
    it('차단한 모델도 뺀 도구도 없으면 기록하지 않는다', async () => {
        await auditInternalOnly({ taskId: 't1', userId: 'u1', removedTools: [] });
        await auditInternalOnly({ taskId: 't1', userId: 'u1', blockedModel: '', removedTools: [] });
        expect(getAuditService).not.toHaveBeenCalled();
        expect(logAudit).not.toHaveBeenCalled();
    });

    it('차단한 모델만 있으면 blockedModel 과 빈 도구 목록을 남긴다', async () => {
        await auditInternalOnly({ taskId: 't1', userId: 'u1', blockedModel: 'anthropic:claude-x', removedTools: [] });
        expect(logAudit).toHaveBeenCalledTimes(1);
        expect(entry()).toEqual({
            action: INTERNAL_ONLY_AUDIT_ACTION,
            userId: 'u1',
            resourceType: 'agent_task',
            resourceId: 't1',
            details: { blockedModel: 'anthropic:claude-x', removedToolCount: 0, removedTools: [] },
        });
    });

    it('뺀 도구만 있으면 blockedModel 키 없이 도구 이름·개수를 남긴다', async () => {
        await auditInternalOnly({ taskId: 't2', userId: 'u2', removedTools: ['mcp__github__create_issue', 'web_search'] });
        const details = entry().details as Record<string, unknown>;
        expect(details).toEqual({ removedToolCount: 2, removedTools: ['mcp__github__create_issue', 'web_search'] });
        expect('blockedModel' in details).toBe(false);
    });

    it('둘 다 있으면 둘 다 담는다', async () => {
        await auditInternalOnly({ taskId: 't3', userId: 'u3', blockedModel: 'openai:gpt-x', removedTools: ['a'] });
        expect(entry().details).toEqual({ blockedModel: 'openai:gpt-x', removedToolCount: 1, removedTools: ['a'] });
    });

    it('도구 이름은 50개까지만 싣고 개수는 전체를 적는다', async () => {
        const tools = Array.from({ length: 120 }, (_, i) => `mcp__ext__tool_${i}`);
        await auditInternalOnly({ taskId: 't4', userId: 'u4', removedTools: tools });
        const details = entry().details as { removedToolCount: number; removedTools: string[] };
        expect(details.removedToolCount).toBe(120);
        expect(details.removedTools).toEqual(tools.slice(0, 50));
    });

    it('넘겨받은 도구 배열을 바꾸지 않는다', async () => {
        const tools = Object.freeze(Array.from({ length: 60 }, (_, i) => `t${i}`));
        await expect(auditInternalOnly({ taskId: 't5', userId: 'u5', removedTools: tools })).resolves.toBeUndefined();
        expect(tools).toHaveLength(60);
    });

    it('기록이 거절돼도 throw 하지 않고 경고만 남긴다(fail-open)', async () => {
        logAudit.mockImplementation(async () => { throw new Error('db down'); });
        await expect(auditInternalOnly({ taskId: 't6', userId: 'u6', blockedModel: 'm', removedTools: [] })).resolves.toBeUndefined();
        expect(warn).toHaveBeenCalledTimes(1);
        expect(warn.mock.calls[0][0]).toContain('[t6]');
        expect(warn.mock.calls[0][0]).toContain('db down');
    });

    it('감사 서비스를 얻는 단계에서 throw 해도 삼킨다', async () => {
        getAuditService.mockImplementation(() => { throw new Error('not initialized'); });
        await expect(auditInternalOnly({ taskId: 't7', userId: 'u7', removedTools: ['x'] })).resolves.toBeUndefined();
        expect(warn.mock.calls[0][0]).toContain('not initialized');
    });

    it('Error 가 아닌 값으로 거절돼도 삼킨다', async () => {
        logAudit.mockImplementation(() => Promise.reject('string-reason'));
        await expect(auditInternalOnly({ taskId: 't8', userId: 'u8', removedTools: ['x'] })).resolves.toBeUndefined();
        expect(warn.mock.calls[0][0]).toContain('string-reason');
    });
});
