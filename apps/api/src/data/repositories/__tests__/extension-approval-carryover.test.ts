/**
 * 확장 업데이트의 승인 이어주기 (2026-09-20).
 *
 * 결함: 업데이트하면 승인한 스킬이 전부 draft 로 돌아가, 재승인 전까지 설치한 팩이 통째로 꺼졌다
 * (법무 팩 1.0.0→1.0.1 라이브 검증: active 5 → draft 5).
 * 계약: 같은 이름으로 다시 들어온 스킬만 승인·배정을 이어받는다. 새로 추가된 스킬은 draft 로 남는다.
 */
import type { Pool } from 'pg';
import { UserExtensionRepository } from '../user-extension-repository';

jest.mock('../../retry-wrapper', () => ({ withRetry: (fn: () => unknown) => fn() }));

function fakePool(rows: unknown[] = []): { pool: Pool; calls: Array<{ sql: string; params: unknown[] }> } {
    const calls: Array<{ sql: string; params: unknown[] }> = [];
    const pool = {
        query: async (sql: string, params: unknown[] = []) => {
            calls.push({ sql: sql.replace(/\s+/g, ' ').trim(), params });
            return { rows: /^SELECT/i.test(sql.trim()) ? rows : [], rowCount: 0 };
        },
    } as unknown as Pool;
    return { pool, calls };
}

describe('snapshotApprovedSkills', () => {
    it('active 스킬을 이름별로 묶고 배정을 함께 돌려준다 (배정 없는 스킬도 포함)', async () => {
        const { pool, calls } = fakePool([
            { name: 'labor-lawyer', agent_id: 'user:3', priority: 5 },
            { name: 'labor-lawyer', agent_id: '__global__', priority: 0 },
            { name: 'patent-attorney', agent_id: null, priority: null },
        ]);

        const snap = await new UserExtensionRepository(pool).snapshotApprovedSkills('ext-1');

        expect(snap).toEqual([
            { name: 'labor-lawyer', assignments: [{ agentId: 'user:3', priority: 5 }, { agentId: '__global__', priority: 0 }] },
            { name: 'patent-attorney', assignments: [] },
        ]);
        expect(calls[0].sql).toContain("s.status = 'active'");
        expect(calls[0].params).toEqual(['ext-1']);
    });
});

describe('carryOverSkillApprovals', () => {
    it('같은 이름의 스킬만 active 로 올리고 배정을 새 id 로 옮긴다', async () => {
        const { pool, calls } = fakePool();

        const carried = await new UserExtensionRepository(pool).carryOverSkillApprovals(
            [{ skillId: 'new-labor', name: 'labor-lawyer' }, { skillId: 'new-tax', name: 'tax-lawyer' }],
            [{ name: 'labor-lawyer', assignments: [{ agentId: 'user:3', priority: 5 }] }],
        );

        expect(carried).toEqual(['new-labor']);
        const updates = calls.filter(c => c.sql.startsWith('UPDATE agent_skills'));
        expect(updates).toHaveLength(1);
        expect(updates[0].params[0]).toBe('new-labor');
        // draft 인 행만 올린다 — 이미 다른 상태면 건드리지 않는다
        expect(updates[0].sql).toContain("status='draft'");
        const inserts = calls.filter(c => c.sql.startsWith('INSERT INTO agent_skill_assignments'));
        expect(inserts).toHaveLength(1);
        expect(inserts[0].params).toEqual(['user:3', 'new-labor', 5]);
    });

    it('새로 추가된 스킬(종전에 없던 이름)은 승인하지 않는다 — draft 로 남아 사용자가 본다', async () => {
        const { pool, calls } = fakePool();

        const carried = await new UserExtensionRepository(pool).carryOverSkillApprovals(
            [{ skillId: 'new-tax', name: 'tax-lawyer' }],
            [{ name: 'labor-lawyer', assignments: [] }],
        );

        expect(carried).toEqual([]);
        expect(calls).toHaveLength(0);
    });

    it('종전에 draft 였던(승인 안 한) 스킬은 스냅샷에 없으므로 이어받지 않는다', async () => {
        const { pool, calls } = fakePool();
        const carried = await new UserExtensionRepository(pool).carryOverSkillApprovals(
            [{ skillId: 'new-a', name: 'a' }], [],
        );
        expect(carried).toEqual([]);
        expect(calls).toHaveLength(0);
    });
});
