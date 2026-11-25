/**
 * skill-runtime 저장 연산 — 업데이트 승인 이어받기 (opt-in 지문 비교, 2026-11-25).
 * 기본(옵션 없음)은 종전대로 이름 기준이고 지문을 계산하지 않는다. requireSameContent 면 지문이 같아야 이어받는다.
 */
import type { StoreDb } from '../../../runtime-ports/component-stores';
import { skillComponentStore } from '../data/skill-component-store';

function fakeDb(rows: (sql: string, params: unknown[]) => unknown[] = () => []): { db: StoreDb; calls: Array<{ sql: string; params: unknown[] }> } {
    const calls: Array<{ sql: string; params: unknown[] }> = [];
    const db = {
        query: async (sql: string, params: unknown[] = []) => {
            const norm = sql.replace(/\s+/g, ' ').trim();
            calls.push({ sql: norm, params });
            const r = /^SELECT/i.test(norm) ? rows(norm, params) : [];
            return { rows: r, rowCount: r.length };
        },
    } as unknown as StoreDb;
    return { db, calls };
}

describe('skillComponentStore — 승인 스냅샷·이어받기', () => {
    it('스냅샷: 기본은 지문 미계산, withFingerprint 면 설명·본문·번들 지문을 계산', async () => {
        const { db, calls } = fakeDb(() => [{ name: 'a', fingerprint: 'fp', agent_id: 'user:3', priority: 2 }]);
        const store = skillComponentStore(db);
        await store.snapshotApproved('ext');
        expect(calls[0].sql).not.toContain('sha256');
        const snap = await store.snapshotApproved('ext', { withFingerprint: true });
        expect(calls[1].sql).toContain('sha256');
        expect(calls[1].sql).toContain('FROM skill_assets a WHERE a.skill_id = s.id');
        expect(snap).toEqual([{ name: 'a', fingerprint: 'fp', assignments: [{ agentId: 'user:3', priority: 2 }] }]);
    });

    it('이어받기: 기본은 이름 기준(지문 조회 없음)', async () => {
        const { db, calls } = fakeDb();
        const carried = await skillComponentStore(db).carryOverApprovals(
            [{ skillId: 'n1', name: 'a' }], [{ name: 'a', fingerprint: '', assignments: [] }],
        );
        expect(carried).toEqual(['n1']);
        expect(calls.some(c => c.sql.includes('sha256'))).toBe(false);
    });

    it('이어받기: requireSameContent 면 지문이 다르면 draft 로 남긴다', async () => {
        const { db, calls } = fakeDb(() => [{ fingerprint: 'fp-new' }]);
        const carried = await skillComponentStore(db).carryOverApprovals(
            [{ skillId: 'n1', name: 'a' }], [{ name: 'a', fingerprint: 'fp-old', assignments: [{ agentId: 'user:3', priority: 1 }] }],
            { requireSameContent: true },
        );
        expect(carried).toEqual([]);
        expect(calls.filter(c => c.sql.startsWith('UPDATE'))).toHaveLength(0);
    });

    it('이어받기: requireSameContent 이고 지문이 같으면 active + 배정 이전', async () => {
        const { db, calls } = fakeDb(() => [{ fingerprint: 'fp' }]);
        const carried = await skillComponentStore(db).carryOverApprovals(
            [{ skillId: 'n1', name: 'a' }], [{ name: 'a', fingerprint: 'fp', assignments: [{ agentId: 'user:3', priority: 1 }] }],
            { requireSameContent: true },
        );
        expect(carried).toEqual(['n1']);
        expect(calls.filter(c => c.sql.startsWith('INSERT INTO agent_skill_assignments'))[0].params).toEqual(['user:3', 'n1', 1]);
    });
});
