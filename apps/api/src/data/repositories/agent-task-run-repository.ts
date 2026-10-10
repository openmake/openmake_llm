/**
 * 에이전트 작업 실행 시작 claim(2026-10-09 점검 ①) — 라우트 /execute·/resume 가 디스패치 직전에 부른다.
 * 주차·부팅 복구 claim 은 agent-task-repository 에 있다(파일 크기 가드로 나눴다).
 *
 * @module data/repositories/agent-task-run-repository
 */
import { BaseRepository } from './base-repository';

/** claimForExecute 가 잡은 실행 시작 claim — 디스패치가 거절되면 revertClaim 이 이것으로 되돌린다. */
export interface ExecuteClaim {
    /** claim 직전 상태(pending/failed/cancelled) */
    prev: string;
    /** claim 이 남긴 updated_at(문자열 그대로 — 마이크로초 보존). 되돌릴 때 "그 뒤로 아무도 안 건드림"의 조건 */
    claimedAt: string;
    /** 처음부터 재실행(execute) claim 이 지운 값 — resume claim 은 지우지 않으므로 없다 */
    reset?: { progress: number; checkpoint: unknown | null };
}

export class AgentTaskRunRepository extends BaseRepository {
    /**
     * 실행 시작 claim(2026-10-09 점검 ①) — /execute·/resume 가 디스패치 직전에 부른다. pending/failed/cancelled 에서만
     * 'queued'(디스패치 접수) 로 원자 전이해 같은 작업의 두 번째 요청은 0행 → 호출부가 400. 서비스가 running 으로
     * 올리기 전 창에서도 재claim 이 막히고, 그 창에서 죽어도 부팅 복구가 queued 행을 집는다. 큐가 실제로 대기시키면
     * dispatchAgentTask 의 queued 갱신은 no-op 이다.
     *
     * resetProgress(처음부터 재실행)는 같은 문장에서 이전 체크포인트도 지운다 — 남겨 두면 서비스가 시작하기 전에 서버가
     * 재시작했을 때 부팅 복구(boot-recovery recoverTask)가 queued 행을 이전 실행의 이어하기로 처리한다. resume claim 은 그대로 둔다.
     */
    async claimForExecute(taskId: string, opts: { resetProgress: boolean; reason: 'execute claim' | 'resume claim' }): Promise<ExecuteClaim | null> {
        const r = await this.query<{ prev: string; claimed_at: string; prev_progress?: number; prev_checkpoint?: unknown }>(
            `UPDATE agent_tasks t SET status = 'queued', updated_at = NOW()${opts.resetProgress ? ', progress = 0, checkpoint = NULL' : ''}
             FROM (SELECT id, status AS prev, progress AS prev_progress, checkpoint AS prev_checkpoint FROM agent_tasks WHERE id = $1 FOR UPDATE) o
             WHERE t.id = o.id AND o.prev IN ('pending', 'failed', 'cancelled')
             RETURNING o.prev, t.updated_at::text AS claimed_at${opts.resetProgress ? ', o.prev_progress, o.prev_checkpoint' : ''}`,
            [taskId],
        );
        const row = r.rows[0];
        if ((r.rowCount ?? 0) === 0 || !row) return null;
        // 전이 이벤트(124) — agent-task-repository.recordEvent 와 같은 fail-open 1행
        await this.recordEvent(taskId, row.prev, 'queued', opts.reason);
        return {
            prev: row.prev,
            claimedAt: row.claimed_at,
            ...(opts.resetProgress ? { reset: { progress: row.prev_progress ?? 0, checkpoint: row.prev_checkpoint ?? null } } : {}),
        };
    }

    /**
     * 실행 시작 claim 되돌리기 — claim 뒤 디스패치가 거절됐을 때(이전 실행의 종료 정리가 끝나기 전 재시도 → 큐 'duplicate').
     * 그대로 두면 실행·대기 항목이 없는 queued 행이 남는다. 내 claim 그대로일 때만(status 가 아직 queued 이고 updated_at 이
     * claim 시각과 같음) 이전 상태·진행률·체크포인트로 복원한다 — 그 사이 취소·다른 claim·복구가 끼었으면 0행(false)이고 건드리지 않는다.
     */
    async revertClaim(taskId: string, claim: ExecuteClaim): Promise<boolean> {
        const r = await this.query(
            `UPDATE agent_tasks SET status = $2, updated_at = NOW()${claim.reset ? ', progress = $4, checkpoint = $5::jsonb' : ''}
             WHERE id = $1 AND status = 'queued' AND updated_at::text = $3`,
            [taskId, claim.prev, claim.claimedAt, ...(claim.reset ? [claim.reset.progress, claim.reset.checkpoint === null ? null : JSON.stringify(claim.reset.checkpoint)] : [])],
        );
        if ((r.rowCount ?? 0) === 0) return false;
        await this.recordEvent(taskId, 'queued', claim.prev, 'claim reverted');
        return true;
    }

    private async recordEvent(taskId: string, from: string | null, to: string, reason: string): Promise<void> {
        await this.query(
            'INSERT INTO agent_task_events (task_id, from_status, to_status, reason) VALUES ($1, $2, $3, $4)',
            [taskId, from, to, reason],
        ).catch(() => { /* 이벤트 기록 실패는 작업을 막지 않는다 */ });
    }
}
