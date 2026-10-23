/**
 * 에이전트 작업 장기 실행 체인(188) — 체인 열 쓰기·이어가기 선점·체인 취소 표식·체인 목록.
 * agent-task-repository 가 파일 크기 가드(600줄)에 닿아 체인 부분만 나눴다. 생성 시 열 쓰기는 createAgentTask 가 chainCreateColumns 로 한다.
 *
 * @module data/repositories/agent-task-chain-repository
 */
import { BaseRepository, QueryParam } from './base-repository';
import type { AgentTask } from '../models/unified-database.types';
import type { LongRunningBudget, ContinuationInfo } from '../../services/agent-task/types';

/** createAgentTask 의 체인 파라미터 — 루트는 자기 id 를 chainRootTaskId 로, 후속은 루트 id·직전 id·continuation 을 받는다 */
export interface AgentTaskChainCreateParams {
    chainRootTaskId?: string;
    continuedFromTaskId?: string;
    longRunning?: LongRunningBudget;
    continuation?: ContinuationInfo;
}

/** INSERT 에 붙일 체인 열 — 값이 있을 때만(188 미적용 배포에서도 체인 없는 생성 경로가 그대로 돈다). */
export function chainCreateColumns(params: AgentTaskChainCreateParams): Array<[string, QueryParam]> {
    const out: Array<[string, QueryParam]> = [];
    if (params.chainRootTaskId !== undefined) out.push(['chain_root_task_id', params.chainRootTaskId]);
    if (params.continuedFromTaskId !== undefined) out.push(['continued_from_task_id', params.continuedFromTaskId]);
    if (params.longRunning !== undefined) out.push(['long_running', JSON.stringify(params.longRunning)]);
    if (params.continuation !== undefined) out.push(['continuation', JSON.stringify(params.continuation)]);
    return out;
}

/** 이어가기 선점 SQL(188) — 비어 있을 때만 후속 id 를 적는다. 원자적 후속 생성(#1473)이 후속 INSERT 와 같은 트랜잭션에서 쓴다. $1 = 부모, $2 = 후속 */
export const CLAIM_CONTINUATION_SQL = 'UPDATE agent_tasks SET continued_by_task_id = $2 WHERE id = $1 AND continued_by_task_id IS NULL';

export type AgentTaskChainRow = Pick<AgentTask, 'id' | 'status' | 'total_tokens' | 'completion_path' | 'continuation' | 'continued_by_task_id' | 'created_at'>;

export class AgentTaskChainRepository extends BaseRepository {
    /** 선점 되돌리기(188) — 후속 생성이 실패했을 때 continued_by_task_id 를 비운다. */
    async resetContinuation(fromTaskId: string, successorId: string): Promise<void> {
        await this.query('UPDATE agent_tasks SET continued_by_task_id = NULL WHERE id = $1 AND continued_by_task_id = $2', [fromTaskId, successorId]);
    }

    /** 체인 취소 표식(188) — 루트의 long_running 에 cancelled 를 병합. 이어가기 직전 판정이 이 표식을 본다. */
    async markChainCancelled(rootId: string): Promise<void> {
        await this.query(
            `UPDATE agent_tasks SET long_running = COALESCE(long_running, '{}'::jsonb) || '{"cancelled":true}'::jsonb WHERE id = $1`,
            [rootId],
        );
    }

    /** 체인 세그먼트 목록(188) — 루트 포함, 만든 순서. */
    async listChain(rootId: string): Promise<AgentTaskChainRow[]> {
        const r = await this.query<AgentTaskChainRow>(
            'SELECT id, status, total_tokens, completion_path, continuation, continued_by_task_id, created_at FROM agent_tasks WHERE chain_root_task_id = $1 ORDER BY created_at ASC',
            [rootId],
        );
        return r.rows;
    }

    /** 체인별 세그먼트 수(루트 포함) — 목록 카드용 서버 집계. 루트 id 들로 한 번에 센다(목록의 상태 필터·개수 제한과 무관). */
    async countChainSegments(rootIds: string[]): Promise<Map<string, number>> {
        if (rootIds.length === 0) return new Map();
        const r = await this.query<{ chain_root_task_id: string; n: string }>(
            'SELECT chain_root_task_id, COUNT(*)::text AS n FROM agent_tasks WHERE chain_root_task_id = ANY($1::text[]) GROUP BY 1',
            [rootIds],
        );
        return new Map(r.rows.map((row) => [row.chain_root_task_id, parseInt(row.n, 10)]));
    }
}
