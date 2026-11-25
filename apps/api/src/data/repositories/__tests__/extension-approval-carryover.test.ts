/**
 * 확장 업데이트의 승인 이어주기 (2026-09-20).
 *
 * 결함: 업데이트하면 승인한 스킬이 전부 draft 로 돌아가, 재승인 전까지 설치한 팩이 통째로 꺼졌다
 * (법무 팩 1.0.0→1.0.1 라이브 검증: active 5 → draft 5).
 * 계약: 같은 이름으로 다시 들어온 스킬만 승인·배정을 이어받는다. 새로 추가된 스킬은 draft 로 남는다.
 * opt-in `requireSameContent`(EXTENSION_APPROVAL_FINGERPRINT, 2026-11-25)면 내용 지문(설명·본문·번들)도 같아야 하고,
 * 바뀐 스킬은 draft 로 남는다. 옵션이 없으면 종전대로 이름만 본다(Base 원칙 — 기본 동작 유지).
 */
import type { Pool } from 'pg';
import { UserExtensionRepository } from '../user-extension-repository';

jest.mock('../../retry-wrapper', () => ({ withRetry: (fn: () => unknown) => fn() }));

function fakePool(rows: unknown[] | ((params: unknown[]) => unknown[]) = []): { pool: Pool; calls: Array<{ sql: string; params: unknown[] }> } {
    const calls: Array<{ sql: string; params: unknown[] }> = [];
    const pool = {
        query: async (sql: string, params: unknown[] = []) => {
            calls.push({ sql: sql.replace(/\s+/g, ' ').trim(), params });
            if (!/^SELECT/i.test(sql.trim())) return { rows: [], rowCount: 0 };
            return { rows: typeof rows === 'function' ? rows(params) : rows, rowCount: 0 };
        },
    } as unknown as Pool;
    return { pool, calls };
}

describe('snapshotApprovedSkills', () => {
    it('active 스킬을 이름별로 묶고 배정을 함께 돌려준다 (배정 없는 스킬도 포함)', async () => {
        const { pool, calls } = fakePool([
            { name: 'labor-lawyer', fingerprint: 'fp-labor', agent_id: 'user:3', priority: 5 },
            { name: 'labor-lawyer', fingerprint: 'fp-labor', agent_id: '__global__', priority: 0 },
            { name: 'patent-attorney', fingerprint: 'fp-patent', agent_id: null, priority: null },
        ]);

        const snap = await new UserExtensionRepository(pool).snapshotApprovedSkills('ext-1', { withFingerprint: true });

        expect(snap).toEqual([
            { name: 'labor-lawyer', fingerprint: 'fp-labor', assignments: [{ agentId: 'user:3', priority: 5 }, { agentId: '__global__', priority: 0 }] },
            { name: 'patent-attorney', fingerprint: 'fp-patent', assignments: [] },
        ]);
        expect(calls[0].sql).toContain("s.status = 'active'");
        // 지문은 설명·본문·번들(경로순 sha256)을 함께 본다
        expect(calls[0].sql).toContain('s.description');
        expect(calls[0].sql).toContain('s.content');
        expect(calls[0].sql).toMatch(/FROM skill_assets a WHERE a\.skill_id = s\.id/);
        expect(calls[0].params).toEqual(['ext-1']);
    });
});

describe('archiveLinkedComponents', () => {
    it('지문 opt-in 이 아니면 스냅샷은 지문을 계산하지 않는다 (기본 동작 유지)', async () => {
        const { pool, calls } = fakePool([{ name: 'a', fingerprint: '', agent_id: null, priority: null }]);
        const snap = await new UserExtensionRepository(pool).snapshotApprovedSkills('ext-1');
        expect(snap).toEqual([{ name: 'a', fingerprint: '', assignments: [] }]);
        expect(calls[0].sql).not.toContain('sha256');
    });

    it('스킬 배정도 함께 지운다 — archived 스킬에 배정이 남으면 도구 바인딩이 계속 따라온다', async () => {
        const { pool, calls } = fakePool();

        await new UserExtensionRepository(pool).archiveLinkedComponents('ext-1');

        const del = calls.find(c => c.sql.startsWith('DELETE FROM agent_skill_assignments'));
        expect(del).toBeDefined();
        expect(del!.params).toEqual(['ext-1']);
        // 배정 삭제가 스킬 archive 보다 **먼저** 와야 한다(archive 가 extension_id 를 NULL 로 만든다)
        const archiveIdx = calls.findIndex(c => c.sql.includes("UPDATE agent_skills SET status='archived'"));
        expect(calls.indexOf(del!)).toBeLessThan(archiveIdx);
    });
});

describe('carryOverSkillApprovals', () => {
    /** 새로 설치된 스킬 id → 지금 지문 */
    const fingerprints = (map: Record<string, string>) => (params: unknown[]) =>
        map[String(params[0])] !== undefined ? [{ fingerprint: map[String(params[0])] }] : [];

    it('같은 이름·같은 내용 지문의 스킬만 active 로 올리고 배정을 새 id 로 옮긴다', async () => {
        const { pool, calls } = fakePool(fingerprints({ 'new-labor': 'fp-labor' }));

        const carried = await new UserExtensionRepository(pool).carryOverSkillApprovals(
            [{ skillId: 'new-labor', name: 'labor-lawyer' }, { skillId: 'new-tax', name: 'tax-lawyer' }],
            [{ name: 'labor-lawyer', fingerprint: 'fp-labor', assignments: [{ agentId: 'user:3', priority: 5 }] }],
            { requireSameContent: true },
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

    it('이름이 같아도 내용(설명·본문·번들)이 바뀌었으면 이어받지 않는다 — draft 로 남아 재승인', async () => {
        const { pool, calls } = fakePool(fingerprints({ 'new-labor': 'fp-labor-v2' }));

        const carried = await new UserExtensionRepository(pool).carryOverSkillApprovals(
            [{ skillId: 'new-labor', name: 'labor-lawyer' }],
            [{ name: 'labor-lawyer', fingerprint: 'fp-labor', assignments: [{ agentId: 'user:3', priority: 5 }] }],
            { requireSameContent: true },
        );

        expect(carried).toEqual([]);
        expect(calls.filter(c => c.sql.startsWith('UPDATE agent_skills'))).toHaveLength(0);
        expect(calls.filter(c => c.sql.startsWith('INSERT INTO agent_skill_assignments'))).toHaveLength(0);
    });

    it('지문이 없는 스냅샷·지문을 읽지 못한 새 스킬은 이어받지 않는다 (판단 근거가 없으면 보수적으로)', async () => {
        const { pool } = fakePool(fingerprints({ 'new-a': 'fp-a' }));
        const repo = new UserExtensionRepository(pool);
        expect(await repo.carryOverSkillApprovals(
            [{ skillId: 'new-a', name: 'a' }], [{ name: 'a', fingerprint: '', assignments: [] }], { requireSameContent: true },
        )).toEqual([]);
        expect(await repo.carryOverSkillApprovals(
            [{ skillId: 'missing', name: 'b' }], [{ name: 'b', fingerprint: 'fp-b', assignments: [] }], { requireSameContent: true },
        )).toEqual([]);
    });

    it('옵션이 없으면 종전대로 이름만 본다 — 지문을 조회하지 않고 내용이 달라도 이어받는다 (기본 동작 유지)', async () => {
        const { pool, calls } = fakePool(fingerprints({ 'new-labor': 'fp-labor-v2' }));

        const carried = await new UserExtensionRepository(pool).carryOverSkillApprovals(
            [{ skillId: 'new-labor', name: 'labor-lawyer' }],
            [{ name: 'labor-lawyer', fingerprint: '', assignments: [{ agentId: 'user:3', priority: 5 }] }],
        );

        expect(carried).toEqual(['new-labor']);
        expect(calls.some(c => c.sql.includes('sha256'))).toBe(false);
        expect(calls.filter(c => c.sql.startsWith('UPDATE agent_skills'))).toHaveLength(1);
    });

    it('새로 추가된 스킬(종전에 없던 이름)은 승인하지 않는다 — draft 로 남아 사용자가 본다', async () => {
        const { pool, calls } = fakePool();

        const carried = await new UserExtensionRepository(pool).carryOverSkillApprovals(
            [{ skillId: 'new-tax', name: 'tax-lawyer' }],
            [{ name: 'labor-lawyer', fingerprint: 'fp-labor', assignments: [] }],
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
