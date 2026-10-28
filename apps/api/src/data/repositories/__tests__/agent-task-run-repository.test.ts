/**
 * 실행 시작 claim(2026-10-09 점검 ①) — pending/failed/cancelled 에서만 queued 로 원자 전이. 0행이면 다른 요청이 먼저 잡은 것.
 */
import type { Pool } from 'pg';
import { AgentTaskRunRepository, recoverableRestartCondition } from '../agent-task-run-repository';

function fakePool(results: Array<{ rows: unknown[]; rowCount?: number }>) {
    const calls: Array<{ sql: string; params: unknown[] }> = [];
    const pool = { query: jest.fn(async (sql: string, params: unknown[] = []) => { calls.push({ sql, params }); return results.shift() ?? { rows: [], rowCount: 0 }; }) };
    return { pool: pool as unknown as Pool, calls };
}

const NO_END = { error: null, failureClass: null, completedAt: null };
const ENDED = { error: 'aborted', failureClass: null, completedAt: '2026-10-10 02:00:00.654321+00' };

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
        expect(claim).toEqual({ prev: 'failed', claimedAt: '2026-10-10 03:00:00.123456+00', ended: NO_END, reset: { progress: 40, checkpoint: cp } });
    });

    it('resume claim 은 체크포인트를 지우지 않는다(이어하기의 근거)', async () => {
        const { pool, calls } = fakePool([{ rows: [{ prev: 'failed', claimed_at: 'ts' }], rowCount: 1 }, { rows: [], rowCount: 1 }]);
        const claim = await new AgentTaskRunRepository(pool).claimForExecute('t1', { resetProgress: false, reason: 'resume claim' });
        expect(calls[0].sql).not.toContain('checkpoint = NULL');
        expect(claim).toEqual({ prev: 'failed', claimedAt: 'ts', ended: NO_END });
    });

    // 취소된 작업을 다시 실행하면 status=running 인데 error='aborted' 가 그대로 조회됐다(라이브 관찰)
    it.each([
        ['execute claim', true],
        ['resume claim', false],
    ] as const)('%s 은 같은 문장에서 이전 종료의 error·failure_class·completed_at 을 지우고, 되돌릴 값으로 돌려준다', async (reason, resetProgress) => {
        const { pool, calls } = fakePool([
            { rows: [{ prev: 'failed', claimed_at: 'ts', prev_error: 'turn_limit', prev_failure_class: 'limit', prev_completed_at: '2026-10-10 02:00:00.654321+00' }], rowCount: 1 },
            { rows: [], rowCount: 1 },
        ]);
        const claim = await new AgentTaskRunRepository(pool).claimForExecute('t1', { resetProgress, reason });
        expect(calls).toHaveLength(2);
        const set = calls[0].sql.slice(0, calls[0].sql.indexOf('FROM ('));
        expect(set).toContain('error = NULL');
        expect(set).toContain('failure_class = NULL');
        expect(set).toContain('completed_at = NULL');
        expect(calls[0].sql).toContain('completed_at::text AS prev_completed_at'); // 문자열 그대로 — 마이크로초 보존
        expect(claim?.ended).toEqual({ error: 'turn_limit', failureClass: 'limit', completedAt: '2026-10-10 02:00:00.654321+00' });
    });
});

describe('AgentTaskRunRepository.revertClaim', () => {
    it('execute claim 을 되돌리면 이전 상태·진행률·체크포인트를 복원한다 — 내 claim 그대로(queued + claim 시각 일치)일 때만', async () => {
        const cp = { conversation: [{ role: 'user', content: 'g' }], completedTurn: 3 };
        const { pool, calls } = fakePool([{ rows: [], rowCount: 1 }, { rows: [], rowCount: 1 }]);
        await expect(new AgentTaskRunRepository(pool).revertClaim('t1', { prev: 'cancelled', claimedAt: 'ts', ended: ENDED, reset: { progress: 40, checkpoint: cp } })).resolves.toBe(true);
        expect(calls[0].sql).toContain("status = 'queued'");
        expect(calls[0].sql).toContain('updated_at::text = $3');
        expect(calls[0].sql).toContain('progress = $7');
        expect(calls[0].sql).toContain('checkpoint = $8');
        expect(calls[0].params).toEqual(['t1', 'cancelled', 'ts', 'aborted', null, ENDED.completedAt, 40, JSON.stringify(cp)]);
        expect(calls[1].params).toEqual(['t1', 'queued', 'cancelled', 'claim reverted']);
    });

    it('체크포인트가 없던 작업은 NULL 로 복원한다', async () => {
        const { pool, calls } = fakePool([{ rows: [], rowCount: 1 }, { rows: [], rowCount: 1 }]);
        await new AgentTaskRunRepository(pool).revertClaim('t1', { prev: 'pending', claimedAt: 'ts', ended: NO_END, reset: { progress: 0, checkpoint: null } });
        expect(calls[0].params).toEqual(['t1', 'pending', 'ts', null, null, null, 0, null]);
    });

    it('resume claim 을 되돌리면 상태와 이전 종료 기록만 복원한다(진행률·체크포인트는 건드린 적이 없다)', async () => {
        const { pool, calls } = fakePool([{ rows: [], rowCount: 1 }, { rows: [], rowCount: 1 }]);
        await new AgentTaskRunRepository(pool).revertClaim('t1', { prev: 'failed', claimedAt: 'ts', ended: NO_END });
        expect(calls[0].sql).not.toContain('checkpoint');
        expect(calls[0].sql).not.toContain('progress');
        expect(calls[0].params).toEqual(['t1', 'failed', 'ts', null, null, null]);
    });

    // claim 이 지운 이전 종료 기록 — 되돌린 행이 "취소됨인데 사유·종료 시각 없음"으로 남으면 안 된다
    it('되돌릴 때 claim 이 지운 error·failure_class·completed_at 을 원래 값으로 복원한다', async () => {
        const { pool, calls } = fakePool([{ rows: [], rowCount: 1 }, { rows: [], rowCount: 1 }]);
        await new AgentTaskRunRepository(pool).revertClaim('t1', { prev: 'failed', claimedAt: 'ts', ended: { error: 'turn_limit', failureClass: 'limit', completedAt: '2026-10-10 02:00:00.654321+00' } });
        expect(calls[0].sql).toContain('error = $4');
        expect(calls[0].sql).toContain('failure_class = $5');
        expect(calls[0].sql).toContain('completed_at = $6');
        expect(calls[0].params).toEqual(['t1', 'failed', 'ts', 'turn_limit', 'limit', '2026-10-10 02:00:00.654321+00']);
    });

    it('그 사이 다른 전이가 있었으면(0행) false 이고 이벤트를 남기지 않는다', async () => {
        const { pool, calls } = fakePool([{ rows: [], rowCount: 0 }]);
        await expect(new AgentTaskRunRepository(pool).revertClaim('t1', { prev: 'failed', claimedAt: 'ts', ended: NO_END })).resolves.toBe(false);
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

// 진행 없이 되풀이되는 복구 끊기 — 작업 하나가 프로세스를 죽이면 재시작 → 자동 재개 → 다시 죽음이 끝없이 돈다
describe('AgentTaskRunRepository.countRecoveriesWithoutProgress', () => {
    it('마지막 진행(체크포인트 기록)·사용자 재실행·이전 중단 뒤의 복구 claim 만 세고, 실행한 적 없는 대기(queued) 재제출은 뺀다', async () => {
        const { pool, calls } = fakePool([{ rows: [{ n: 2 }], rowCount: 1 }]);
        await expect(new AgentTaskRunRepository(pool).countRecoveriesWithoutProgress('t1')).resolves.toBe(2);
        expect(calls[0].sql).toContain('FROM agent_task_events');
        expect(calls[0].sql).toContain("IS DISTINCT FROM 'queued'");
        expect(calls[0].sql).toContain('agent_task_checkpoints');
        expect(calls[0].params).toEqual(['t1', 'boot recovery claim', ['recovery_limit', 'execute claim', 'resume claim']]);
    });

    it('행이 없으면 0', async () => {
        const { pool } = fakePool([{ rows: [], rowCount: 0 }]);
        await expect(new AgentTaskRunRepository(pool).countRecoveriesWithoutProgress('t1')).resolves.toBe(0);
    });
});

describe('AgentTaskRunRepository.failRecoveryLimit', () => {
    it('읽을 때의 상태 그대로인 중단 작업만 failed(recovery_limit)로 닫고 알림 표식·이벤트를 남긴다 — 체크포인트는 건드리지 않는다', async () => {
        const { pool, calls } = fakePool([{ rows: [{ prev: 'failed' }], rowCount: 1 }, { rows: [], rowCount: 1 }]);
        await expect(new AgentTaskRunRepository(pool).failRecoveryLimit('t1', 'failed')).resolves.toBe(true);
        expect(calls[0].sql).toContain("SET status = 'failed'");
        expect(calls[0].sql).toContain('terminal_notify_pending = TRUE');
        expect(calls[0].sql).toContain('FOR UPDATE');
        expect(calls[0].sql).not.toContain('checkpoint');
        expect(calls[0].params).toEqual(['t1', 'recovery_limit', 'interrupted', 'failed', 'server restarted']);
        expect(calls[1].params).toEqual(['t1', 'failed', 'failed', 'recovery_limit']);
    });

    it('그 사이 다른 요청이 잡았으면(0행) false 이고 이벤트를 남기지 않는다', async () => {
        const { pool, calls } = fakePool([{ rows: [], rowCount: 0 }]);
        await expect(new AgentTaskRunRepository(pool).failRecoveryLimit('t1', 'running')).resolves.toBe(false);
        expect(calls).toHaveLength(1);
    });

    // (2026-10-22 R2) claim 과 running 사이에서 죽은 행 — 소유권 있는 pending 만, 소유권 없는(실행한 적 없는) pending 은 아니다
    it('소유권 있는 pending(claim 고아)도 닫는다 — 그 상태를 읽었을 때만 소유권 컬럼을 본다', async () => {
        const { pool, calls } = fakePool([{ rows: [{ prev: 'pending' }], rowCount: 1 }, { rows: [], rowCount: 1 }, { rows: [], rowCount: 0 }]);
        const repo = new AgentTaskRunRepository(pool);
        await expect(repo.failRecoveryLimit('t1', 'pending', 'host:0')).resolves.toBe(true);
        // (#1473) 지났거나 내 것일 때만 — 목록을 읽은 뒤 다른 서버가 claim 해 간 pending 은 닫지 않는다
        expect(calls[0].sql).toContain("((o.prev = 'pending' AND o.lease_until IS NOT NULL) AND (o.lease_until < NOW() OR o.lease_owner = $6))");
        expect(calls[0].sql).toContain('SELECT id, status AS prev, error AS prev_error, lease_until, lease_owner FROM agent_tasks');
        expect(calls[0].params).toEqual(['t1', 'recovery_limit', 'interrupted', 'pending', 'server restarted', 'host:0']);
        expect(calls[1].params).toEqual(['t1', 'pending', 'failed', 'recovery_limit']);
        await repo.failRecoveryLimit('t1', 'running', 'host:0');
        expect(calls[2].sql).not.toContain('lease_'); // pending 이 아니면 종전 문장 그대로
        expect(calls[2].params).toEqual(['t1', 'recovery_limit', 'interrupted', 'running', 'server restarted']);
    });

    it('소유권 owner 없이 pending 을 넘기면 pending 행을 맞추지 않는다(안전한 기본 — 남의 claim 을 닫지 않게)', async () => {
        const { pool, calls } = fakePool([{ rows: [], rowCount: 0 }]);
        await expect(new AgentTaskRunRepository(pool).failRecoveryLimit('t1', 'pending')).resolves.toBe(false);
        expect(calls).toHaveLength(1);
        expect(calls[0].sql).not.toContain('lease_');
        expect(calls[0].sql).not.toContain("o.prev = 'pending'");
        expect(calls[0].params).toEqual(['t1', 'recovery_limit', 'interrupted', 'pending', 'server restarted']);
    });
});

// 종료 알림 보류 — 부팅 복구가 되살릴 행은 알리지 않는다. 로컬 기기 작업도 기기 대기로 주차하게 되면 되살릴 행이다
describe('recoverableRestartCondition', () => {
    it('로컬 작업을 되살리지 못하는 설정이면 로컬 실행을 뺀다', () => {
        expect(recoverableRestartCondition('$4', false)).toContain("executor IS DISTINCT FROM 'local'");
    });
    it('로컬 작업을 기기 대기로 되살리는 설정이면 로컬 실행도 보류한다', () => {
        const sql = recoverableRestartCondition('$4', true);
        expect(sql).not.toContain("'local'");
        expect(sql).toContain("error = 'server restarted'");
    });
});
