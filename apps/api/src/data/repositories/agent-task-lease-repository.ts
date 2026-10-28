/**
 * 에이전트 작업 실행 소유권(176) — 잡기·연장·반납·지난 소유권 목록·가져오기.
 * agent-task-repository 가 파일 크기 가드(600줄)에 닿아 이 부분만 나눴다. 부팅 복구 조회(getInterruptedAgentTasks)의 소유권 조건은 agent-task-repository 에 있다.
 *
 * @module data/repositories/agent-task-lease-repository
 */
import { BaseRepository } from './base-repository';
import type { AgentTask } from '../models/unified-database.types';
import { parkedTaskCondition } from './agent-task-repository';
import { claimableLeaseSql, expiredLeaseSql } from './agent-task-lease-sql';

/** 지난 소유권 조건은 agent-task-lease-sql 로 옮겼다(#1473) — 기존 import 를 위해 다시 내보낸다. */
export { expiredLeaseSql };

/** 살아 있는 소유권인가(#1473) — expiredLeaseSql 의 반대쪽. NULL 은 false(살아 있는 소유자가 없다). */
export function hasLiveLease(leaseUntil: string | Date | null | undefined, now: number = Date.now()): boolean {
    return leaseUntil != null && new Date(leaseUntil).getTime() >= now;
}

/**
 * 재디스패치 claim 의 "오래됨" 기준(#1473) — staleMs: 마지막 갱신이 지금보다 이만큼 이전(R3), updatedBefore: 고정 시각 이전(부팅 복구 —
 * 이 프로세스가 뜬 시각). 부팅은 반드시 고정 시각을 쓴다: 상대 길이를 움직이는 NOW() 에 대면 기준이 시간과 함께 앞으로 밀려
 * 다른 복구자가 방금 claim 한 행·이 프로세스가 만든 행까지 다시 잡는다.
 */
export type UnleasedClaimCutoff = { staleMs: number } | { updatedBefore: Date };

function cutoffSql(cutoff: UnleasedClaimCutoff, n: number): { sql: string; param: number | string } {
    return 'staleMs' in cutoff
        ? { sql: `updated_at < NOW() - make_interval(secs => $${n})`, param: cutoff.staleMs / 1000 }
        : { sql: `updated_at < $${n}::timestamptz`, param: cutoff.updatedBefore.toISOString() };
}

export class AgentTaskLeaseRepository extends BaseRepository {
    /** 실행 소유권(176) 잡기 — 소유권이 없거나, 내 것이거나, 지났을 때만. 다른 서버의 살아 있는 소유권이면 false. */
    async acquireLease(taskId: string, owner: string, leaseMs: number): Promise<boolean> {
        const r = await this.query(
            `UPDATE agent_tasks SET lease_owner = $2, lease_until = NOW() + make_interval(secs => $3)
             WHERE id = $1 AND ${claimableLeaseSql('$2')}`,
            [taskId, owner, leaseMs / 1000]);
        return (r.rowCount ?? 0) > 0;
    }

    /** 실행 소유권 연장 — 여전히 내 것일 때만. 0행이면 다른 서버가 가져갔다. */
    async renewLease(taskId: string, owner: string, leaseMs: number): Promise<boolean> {
        const r = await this.query(
            `UPDATE agent_tasks SET lease_until = NOW() + make_interval(secs => $3) WHERE id = $1 AND lease_owner = $2`,
            [taskId, owner, leaseMs / 1000]);
        return (r.rowCount ?? 0) > 0;
    }

    /** 실행 소유권 반납 — 내 것일 때만. */
    async releaseLease(taskId: string, owner: string): Promise<void> {
        await this.query(`UPDATE agent_tasks SET lease_owner = NULL, lease_until = NULL WHERE id = $1 AND lease_owner = $2`, [taskId, owner]);
    }

    /**
     * 소유권이 지난 실행 중 작업(주차 제외) — 소유권을 잡아 본 적 없는 작업(lease_until NULL)은 대상이 아니다.
     * pending 도 본다 — claim 이 같은 문장에서 소유권을 쓰므로 소유권 있는 pending 은 claim 과 running 사이에서 죽은 행이다(2026-10-22 R2).
     */
    async listExpiredLeaseTasks(): Promise<AgentTask[]> {
        const r = await this.query<AgentTask>(
            `SELECT * FROM agent_tasks
             WHERE status IN ('running', 'paused', 'pending') AND ${expiredLeaseSql()}
               AND NOT ${parkedTaskCondition('agent_tasks')}
             ORDER BY lease_until ASC LIMIT 50`);
        return r.rows;
    }

    /** 지난 소유권을 원자적으로 가져온다 — 여러 서버가 동시에 시도해도 한 곳만 성공한다. */
    async takeOverExpiredLease(taskId: string, owner: string, leaseMs: number): Promise<boolean> {
        const r = await this.query(
            `UPDATE agent_tasks SET lease_owner = $2, lease_until = NOW() + make_interval(secs => $3)
             WHERE id = $1 AND status IN ('running', 'paused', 'pending') AND ${expiredLeaseSql()}`,
            [taskId, owner, leaseMs / 1000]);
        return (r.rowCount ?? 0) > 0;
    }

    /**
     * 소유권 없는 pending 이어가기 후속(#1473) — 체크포인트 시드가 있고 마지막 갱신이 updatedBefore(이 프로세스가 뜬 시각) 이전인 것.
     * 부팅 복구가 "이 프로세스가 뜨기 전에" 커밋된 채 디스패치되지 못한 후속을 찾는다. id 순 keyset 페이지(afterId 다음부터) —
     * 복구하지 못한 행이 있어도 커서가 앞으로만 가서 다음 페이지가 굶지 않고 끝난다. 종료·실행 중·주차·소유권 있는 행은 대상이 아니다
     * — 소유권 있는 것은 R2 가 맡는다.
     */
    async listUnleasedPendingSuccessors(updatedBefore: Date, afterId: string | null = null, limit = 50): Promise<AgentTask[]> {
        const r = await this.query<AgentTask>(
            `SELECT * FROM agent_tasks
             WHERE status = 'pending' AND lease_until IS NULL AND continued_from_task_id IS NOT NULL AND checkpoint IS NOT NULL
               AND updated_at < $1::timestamptz AND ($2::text IS NULL OR id > $2)
             ORDER BY id ASC LIMIT $3`,
            [updatedBefore.toISOString(), afterId, limit]);
        return r.rows;
    }

    /**
     * 소유권 없는 pending 후속의 재디스패치 claim(#1473, R3·부팅 복구) — 소유권을 잡은 적 없고(lease_until NULL) 마지막 갱신이 cutoff 보다
     * 오래된 행만, 여러 복구자 중 한 곳만 잡는다(claim 이 updated_at 을 지금으로 올리므로 같은 기준의 다음 claim 은 0행). lease 를 주면 같은 문장에서 소유권을 쓴다(실행이 같은 owner 로 이어 잡는다).
     * 없으면(소유권 꺼짐) updated_at 만 갱신한다 — 다른 복구자는 "방금 갱신(디스패치 중)" 으로 보고, 꺼진 R2 만 기다리는 소유권
     * 표식은 남기지 않는다. 소유권이 있는 행(살아 있든 지났든)은 대상이 아니다 — 지난 것은 takeOverExpiredLease(R2)가 맡는다.
     */
    async claimUnleasedPendingForRedispatch(taskId: string, cutoff: UnleasedClaimCutoff, lease?: { owner: string; leaseMs: number }): Promise<boolean> {
        const c = cutoffSql(cutoff, 2);
        const r = await this.query(
            `UPDATE agent_tasks SET updated_at = NOW()${lease ? ', lease_owner = $3, lease_until = NOW() + make_interval(secs => $4)' : ''}
             WHERE id = $1 AND status = 'pending' AND lease_until IS NULL AND ${c.sql}`,
            lease ? [taskId, c.param, lease.owner, lease.leaseMs / 1000] : [taskId, c.param]);
        return (r.rowCount ?? 0) > 0;
    }
}
