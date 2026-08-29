import { recordSkillUsage, hashArgs, getSkillUsageSummary, GUEST_USER_ID, UNKNOWN_SKILL_VERSION } from '../skill-usage-log';

const mockQuery = jest.fn();
jest.mock('../../data/models/unified-database', () => ({
    getUnifiedDatabase: () => ({ getPool: () => ({ query: mockQuery }) }),
}));

const flush = () => new Promise(r => setImmediate(r));

describe('skill-usage-log', () => {
    beforeEach(() => { mockQuery.mockReset(); mockQuery.mockResolvedValue({ rows: [] }); });

    it('recordSkillUsage — 배치 1회 INSERT(unnest), guest/legacy 폴백, args 는 해시만', async () => {
        recordSkillUsage([
            { skillId: 's1', kind: 'inject', userId: 'u3', skillVersion: '1.0.0', args: { agentId: 'a' } },
            { skillId: 's2', kind: 'slash', args: 'x', durationMs: 12.6 },
        ]);
        await flush();
        expect(mockQuery).toHaveBeenCalledTimes(1);
        const [sql, params] = mockQuery.mock.calls[0];
        expect(String(sql)).toContain('INSERT INTO skill_audit_log');
        expect(String(sql)).toContain('unnest');
        expect(params[0]).toEqual(['u3', GUEST_USER_ID]);
        expect(params[1]).toEqual(['s1', 's2']);
        expect(params[2]).toEqual(['1.0.0', UNKNOWN_SKILL_VERSION]);
        expect(params[3]).toEqual(['inject', 'slash']);
        expect(params[4]).toEqual([hashArgs({ agentId: 'a' }), hashArgs('x')]);
        expect(params[4][0]).toMatch(/^[0-9a-f]{64}$/);
        expect(params[5]).toEqual(['ok', 'ok']);
        expect(params[6]).toEqual([null, 13]);
    });

    it('빈 목록·skillId 없는 이벤트는 쿼리 없음', async () => {
        recordSkillUsage([]);
        recordSkillUsage([{ skillId: '', kind: 'slash' }]);
        await flush();
        expect(mockQuery).not.toHaveBeenCalled();
    });

    it('DB 실패는 삼킨다 (fail-open, throw 없음)', async () => {
        mockQuery.mockRejectedValueOnce(new Error('db down'));
        expect(() => recordSkillUsage([{ skillId: 's1', kind: 'load_skill' }])).not.toThrow();
        await flush();
        expect(mockQuery).toHaveBeenCalledTimes(1);
    });

    it('getSkillUsageSummary — 소유자 필터·기간 파라미터·행 매핑', async () => {
        mockQuery.mockResolvedValueOnce({ rows: [{
            skill_id: 's1', name: 'Billing', status: 'active', created_by: 'u3',
            total: '3', by_kind: { slash: 2, inject: 1 }, last_used_at: new Date('2026-08-29T00:00:00Z'),
        }] });
        const rows = await getSkillUsageSummary({ days: 7, ownerUserId: 'u3' });
        const [sql, params] = mockQuery.mock.calls[0];
        expect(String(sql)).toContain('s.created_by = $2');
        expect(params).toEqual([7, 'u3']);
        expect(rows).toEqual([{ skillId: 's1', name: 'Billing', status: 'active', createdBy: 'u3', total: 3, byKind: { slash: 2, inject: 1 }, lastUsedAt: '2026-08-29T00:00:00.000Z' }]);
        mockQuery.mockResolvedValueOnce({ rows: [] });
        await getSkillUsageSummary({ days: 30 });
        expect(String(mockQuery.mock.calls[1][0])).not.toContain('created_by = $2');
    });
});
