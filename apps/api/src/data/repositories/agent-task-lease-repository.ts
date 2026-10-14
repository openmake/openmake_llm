/**
 * 에이전트 작업 실행 소유권(176) — 잡기·연장·반납·지난 소유권 목록·가져오기.
 * agent-task-repository 가 파일 크기 가드(600줄)에 닿아 이 부분만 나눴다. 부팅 복구 조회(getInterruptedAgentTasks)의 소유권 조건은 agent-task-repository 에 있다.
 *
 * @module data/repositories/agent-task-lease-repository
 */
import { BaseRepository } from './base-repository';
import type { AgentTask } from '../models/unified-database.types';
import { parkedTaskCondition } from './agent-task-repository';

export class AgentTaskLeaseRepository extends BaseRepository {
    /** 실행 소유권(176) 잡기 — 소유권이 없거나, 내 것이거나, 지났을 때만. 다른 서버의 살아 있는 소유권이면 false. */
    async acquireLease(taskId: string, owner: string, leaseMs: number): Promise<boolean> {
        const r = await this.query(
            `UPDATE agent_tasks SET lease_owner = $2, lease_until = NOW() + make_interval(secs => $3)
             WHERE id = $1 AND (lease_owner IS NULL OR lease_owner = $2 OR lease_until < NOW())`,
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

    /** 소유권이 지난 실행 중 작업(주차 제외) — 소유권을 잡아 본 적 없는 작업(lease_until NULL)은 대상이 아니다. */
    async listExpiredLeaseTasks(): Promise<AgentTask[]> {
        const r = await this.query<AgentTask>(
            `SELECT * FROM agent_tasks
             WHERE status IN ('running', 'paused') AND lease_until IS NOT NULL AND lease_until < NOW()
               AND NOT ${parkedTaskCondition('agent_tasks')}
             ORDER BY lease_until ASC LIMIT 50`);
        return r.rows;
    }

    /** 지난 소유권을 원자적으로 가져온다 — 여러 서버가 동시에 시도해도 한 곳만 성공한다. */
    async takeOverExpiredLease(taskId: string, owner: string, leaseMs: number): Promise<boolean> {
        const r = await this.query(
            `UPDATE agent_tasks SET lease_owner = $2, lease_until = NOW() + make_interval(secs => $3)
             WHERE id = $1 AND status IN ('running', 'paused') AND lease_until IS NOT NULL AND lease_until < NOW()`,
            [taskId, owner, leaseMs / 1000]);
        return (r.rowCount ?? 0) > 0;
    }
}
