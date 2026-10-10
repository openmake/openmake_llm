/**
 * 실행 시작 claim(2026-10-09 점검 ①) — pending/failed/cancelled 에서만 queued 로 원자 전이. 0행이면 다른 요청이 먼저 잡은 것.
 */
import type { Pool } from 'pg';
import { AgentTaskRunRepository } from '../agent-task-run-repository';

function fakePool(results: Array<{ rows: unknown[]; rowCount?: number }>) {
    const calls: Array<{ sql: string; params: unknown[] }> = [];
    const pool = { query: jest.fn(async (sql: string, params: unknown[] = []) => { calls.push({ sql, params }); return results.shift() ?? { rows: [], rowCount: 0 }; }) };
    return { pool: pool as unknown as Pool, calls };
}

describe('AgentTaskRunRepository.claimForExecute', () => {
    it('pending/failed/cancelled 에서만 queued 로 잡고 이전 상태로 이벤트를 남긴다', async () => {
        const { pool, calls } = fakePool([{ rows: [{ prev: 'failed' }], rowCount: 1 }, { rows: [], rowCount: 1 }]);
        await expect(new AgentTaskRunRepository(pool).claimForExecute('t1', { resetProgress: true, reason: 'execute claim' })).resolves.toMatchObject({ prev: 'failed' });
        expect(calls[0].sql).toContain("SET status = 'queued'");
        expect(calls[0].sql).toContain('progress = 0');
        expect(calls[0].sql).toContain("o.prev IN ('pending', 'failed', 'cancelled')");
        expect(calls[0].sql).toContain('FOR UPDATE');
        expect(calls[0].sql).toContain('RETURNING o.prev');
        expect(calls[0].params).toEqual(['t1']);
        expect(calls[1].sql).toContain('INSERT INTO agent_task_events');
        expect(calls[1].params).toEqual(['t1', 'failed', 'queued', 'execute claim']);
    });

    it('resume claim 은 progress 를 건드리지 않는다', async () => {
        const { pool, calls } = fakePool([{ rows: [{ prev: 'cancelled' }], rowCount: 1 }, { rows: [], rowCount: 1 }]);
        await expect(new AgentTaskRunRepository(pool).claimForExecute('t1', { resetProgress: false, reason: 'resume claim' })).resolves.toMatchObject({ prev: 'cancelled' });
        expect(calls[0].sql).not.toContain('progress = 0');
        expect(calls[1].params).toEqual(['t1', 'cancelled', 'queued', 'resume claim']);
    });

    it('0행(이미 queued/running/paused/completed)이면 null 이고 이벤트를 남기지 않는다', async () => {
        const { pool, calls } = fakePool([{ rows: [], rowCount: 0 }]);
        await expect(new AgentTaskRunRepository(pool).claimForExecute('t1', { resetProgress: true, reason: 'execute claim' })).resolves.toBeNull();
        expect(calls).toHaveLength(1);
    });

    // 처음부터 재실행 직후 재시작 — 이전 체크포인트가 남으면 부팅 복구가 queued 행을 이어하기로 처리한다
    it('execute claim 은 같은 문장에서 이전 체크포인트를 지우고, 되돌릴 재료(이전 진행률·체크포인트·claim 시각)를 돌려준다', async () => {
        const cp = { conversation: [{ role: 'user', content: 'g' }], completedTurn: 3 };
        const { pool, calls } = fakePool([
            { rows: [{ prev: 'failed', prev_progress: 40, prev_checkpoint: cp, claimed_at: '2026-10-10 03:00:00.123456+00' }], rowCount: 1 },
            { rows: [], rowCount: 1 },
        ]);
        const claim = await new AgentTaskRunRepository(pool).claimForExecute('t1', { resetProgress: true, reason: 'execute claim' });
        expect(calls).toHaveLength(2); // claim 1문장 + 이벤트 — 체크포인트 정리는 별도 문장이 아니다
        expect(calls[0].sql).toContain('checkpoint = NULL');
        expect(claim).toEqual({ prev: 'failed', claimedAt: '2026-10-10 03:00:00.123456+00', reset: { progress: 40, checkpoint: cp } });
    });

    it('resume claim 은 체크포인트를 지우지 않는다(이어하기의 근거)', async () => {
        const { pool, calls } = fakePool([{ rows: [{ prev: 'failed', claimed_at: 'ts' }], rowCount: 1 }, { rows: [], rowCount: 1 }]);
        const claim = await new AgentTaskRunRepository(pool).claimForExecute('t1', { resetProgress: false, reason: 'resume claim' });
        expect(calls[0].sql).not.toContain('checkpoint = NULL');
        expect(claim).toEqual({ prev: 'failed', claimedAt: 'ts' });
    });
});

describe('AgentTaskRunRepository.revertClaim', () => {
    it('execute claim 을 되돌리면 이전 상태·진행률·체크포인트를 복원한다 — 내 claim 그대로(queued + claim 시각 일치)일 때만', async () => {
        const cp = { conversation: [{ role: 'user', content: 'g' }], completedTurn: 3 };
        const { pool, calls } = fakePool([{ rows: [], rowCount: 1 }, { rows: [], rowCount: 1 }]);
        await expect(new AgentTaskRunRepository(pool).revertClaim('t1', { prev: 'cancelled', claimedAt: 'ts', reset: { progress: 40, checkpoint: cp } })).resolves.toBe(true);
        expect(calls[0].sql).toContain("status = 'queued'");
        expect(calls[0].sql).toContain('updated_at::text = $3');
        expect(calls[0].sql).toContain('progress = $4');
        expect(calls[0].sql).toContain('checkpoint = $5');
        expect(calls[0].params).toEqual(['t1', 'cancelled', 'ts', 40, JSON.stringify(cp)]);
        expect(calls[1].params).toEqual(['t1', 'queued', 'cancelled', 'claim reverted']);
    });

    it('체크포인트가 없던 작업은 NULL 로 복원한다', async () => {
        const { pool, calls } = fakePool([{ rows: [], rowCount: 1 }, { rows: [], rowCount: 1 }]);
        await new AgentTaskRunRepository(pool).revertClaim('t1', { prev: 'pending', claimedAt: 'ts', reset: { progress: 0, checkpoint: null } });
        expect(calls[0].params).toEqual(['t1', 'pending', 'ts', 0, null]);
    });

    it('resume claim 을 되돌리면 상태만 복원한다', async () => {
        const { pool, calls } = fakePool([{ rows: [], rowCount: 1 }, { rows: [], rowCount: 1 }]);
        await new AgentTaskRunRepository(pool).revertClaim('t1', { prev: 'failed', claimedAt: 'ts' });
        expect(calls[0].sql).not.toContain('checkpoint');
        expect(calls[0].sql).not.toContain('progress');
        expect(calls[0].params).toEqual(['t1', 'failed', 'ts']);
    });

    it('그 사이 다른 전이가 있었으면(0행) false 이고 이벤트를 남기지 않는다', async () => {
        const { pool, calls } = fakePool([{ rows: [], rowCount: 0 }]);
        await expect(new AgentTaskRunRepository(pool).revertClaim('t1', { prev: 'failed', claimedAt: 'ts' })).resolves.toBe(false);
        expect(calls).toHaveLength(1);
    });
});

describe('AgentTaskRunRepository.failUnstartedClaim', () => {
    it('아직 claim 상태(queued·pending)일 때만 failed 로 닫고 종료 알림 표식·분류·이벤트를 남긴다', async () => {
        const { pool, calls } = fakePool([{ rows: [{ prev: 'queued' }], rowCount: 1 }, { rows: [], rowCount: 1 }]);
        await expect(new AgentTaskRunRepository(pool).failUnstartedClaim('t1', 'lease_held_elsewhere')).resolves.toBe(true);
        expect(calls[0].sql).toContain("SET status = 'failed'");
        expect(calls[0].sql).toContain("o.prev IN ('queued', 'pending')");
        expect(calls[0].sql).toContain('FOR UPDATE');
        expect(calls[0].sql).toContain('terminal_notify_pending = TRUE');
        expect(calls[0].sql).toContain('completed_at = NOW()');
        expect(calls[0].params).toEqual(['t1', 'lease_held_elsewhere', 'interrupted']);
        expect(calls[1].params).toEqual(['t1', 'queued', 'failed', 'lease_held_elsewhere']);
    });

    it('0행(다른 서버가 이미 running 으로 올림·취소됨)이면 false 이고 이벤트를 남기지 않는다', async () => {
        const { pool, calls } = fakePool([{ rows: [], rowCount: 0 }]);
        await expect(new AgentTaskRunRepository(pool).failUnstartedClaim('t1', 'lease_held_elsewhere')).resolves.toBe(false);
        expect(calls).toHaveLength(1);
    });
});
