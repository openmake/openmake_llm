/**
 * db-retention — 만료된 대화 공유 미리보기(198) 정리. 게시는 만료 draft 를 이미 거절하고, 여기서는 행 누적만 막는다.
 * 공유 자체(conversation_shares)는 지우지 않는다.
 */
const mockQuery = jest.fn();
jest.mock('../models/unified-database', () => ({
    getUnifiedDatabase: () => ({ getPool: () => ({ query: mockQuery }) }),
}));

import { startDbRetention } from '../db-retention';

async function runOnce(): Promise<string[]> {
    const spy = jest.spyOn(global, 'setInterval');
    startDbRetention();
    for (let i = 0; i < 50; i++) await new Promise((resolve) => setImmediate(resolve));
    for (const r of spy.mock.results) clearInterval(r.value as NodeJS.Timeout);
    spy.mockRestore();
    return mockQuery.mock.calls.map((c) => String(c[0]));
}

describe('db-retention — 대화 공유 미리보기', () => {
    beforeEach(() => {
        mockQuery.mockReset();
        mockQuery.mockResolvedValue({ rowCount: 0, rows: [] });
    });

    it('expires_at 이 지난 미리보기만 지우고 공유는 건드리지 않는다', async () => {
        const sqls = await runOnce();
        const previews = sqls.filter((s) => /DELETE\s+FROM\s+conversation_share_previews/i.test(s));
        expect(previews).toHaveLength(1);
        expect(previews[0]).toMatch(/WHERE\s+expires_at\s*<=?\s*NOW\(\)/i);
        expect(sqls.some((s) => /DELETE\s+FROM\s+conversation_shares\b/i.test(s))).toBe(false);
    });

    it('표가 없어도(198 적용 전) 다른 정리를 막지 않는다', async () => {
        mockQuery.mockImplementation(async (sql: string) => {
            if (/conversation_share_previews/.test(sql)) throw Object.assign(new Error('relation does not exist'), { code: '42P01' });
            return { rowCount: 0, rows: [] };
        });
        const sqls = await runOnce();
        const idx = sqls.findIndex((s) => /conversation_share_previews/.test(s));
        expect(idx).toBeGreaterThanOrEqual(0);
        expect(sqls.length).toBeGreaterThan(idx + 1);
    });
});
