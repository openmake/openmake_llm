/**
 * backfillUserMemories — 저장 후 memory.backfilled audit 을 **await** 하는지(CLI 가 반환 직후
 * process.exit 하므로 fire-and-forget 이면 행이 유실된다). pool/LLM/audit 전부 mock.
 */
const repoMock = {
    listKnownContentsByUser: jest.fn().mockResolvedValue([]),
    countActiveByUser: jest.fn().mockResolvedValue(0),
    create: jest.fn(async (id: string, userId: string, content: string, source: string) => ({ id, user_id: userId, content, source })),
};
jest.mock('../../data/repositories/user-memory-repository', () => ({ UserMemoryRepository: jest.fn().mockImplementation(() => repoMock) }));
jest.mock('../../data/models/unified-database', () => ({
    getPool: () => ({ query: jest.fn().mockResolvedValue({ rows: [{ id: 's1', user_text: '나는 파이썬을 선호해. '.repeat(4) }] }) }),
}));
jest.mock('../../llm/client', () => ({ createClient: () => ({}) }));
jest.mock('./memory-extraction', () => ({
    ...jest.requireActual('./memory-extraction'),
    extractLLMMemories: jest.fn().mockResolvedValue(['사용자는 파이썬을 선호한다']),
}));
let auditSettled = false;
const logAudit = jest.fn(() => new Promise<void>((r) => setTimeout(() => { auditSettled = true; r(); }, 20)));
jest.mock('../AuditService', () => ({ getAuditService: () => ({ logAudit }) }));

import { backfillUserMemories } from './memory-backfill';

beforeEach(() => { auditSettled = false; logAudit.mockClear(); repoMock.create.mockClear(); });

describe('backfillUserMemories — audit', () => {
    it('저장 후 memory.backfilled audit 이 완료된 뒤에 반환한다', async () => {
        const r = await backfillUserMemories('u1', { maxSessions: 1, minChars: 1 });
        expect(r.saved).toBe(1);
        expect(logAudit).toHaveBeenCalledTimes(1);
        expect(auditSettled).toBe(true); // 반환 시점에 이미 flush 됨 — process.exit 안전
        const input = (logAudit.mock.calls[0] as unknown[])[0] as { action: string; userId: string; details: Record<string, unknown> };
        expect(input.action).toBe('memory.backfilled');
        expect(input.userId).toBe('u1');
        expect(input.details.count).toBe(1);
        expect(JSON.stringify(input.details)).not.toContain('파이썬');
    });

    it('dryRun 은 저장·audit 모두 없음', async () => {
        const r = await backfillUserMemories('u1', { dryRun: true, maxSessions: 1, minChars: 1 });
        expect(r.dryRun).toBe(true);
        expect(r.fresh).toHaveLength(1);
        expect(repoMock.create).not.toHaveBeenCalled();
        expect(logAudit).not.toHaveBeenCalled();
    });
});
