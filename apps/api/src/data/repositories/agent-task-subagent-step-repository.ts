/**
 * @module data/repositories/agent-task-subagent-step-repository
 * @description `agent_task_subagent_steps`(109) — delegate/spawn 서브에이전트 활동 기록.
 * 쓰기는 fire-and-forget(서브 실행을 늦추지 않음), 읽기는 작업 단위 전체.
 */
import { BaseRepository } from './base-repository';

export interface SubagentStepRow {
    id: string;
    task_id: string;
    trace_id: string;
    origin: string;
    sub_index: number;
    label: string | null;
    seq: number;
    step_type: string;
    tool_name: string | null;
    content: string | null;
    created_at: Date;
}

export class AgentTaskSubagentStepRepository extends BaseRepository {
    async add(row: Omit<SubagentStepRow, 'id' | 'created_at'>): Promise<void> {
        await this.query(
            `INSERT INTO agent_task_subagent_steps
                (task_id, trace_id, origin, sub_index, label, seq, step_type, tool_name, content)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
            [row.task_id, row.trace_id, row.origin, row.sub_index, row.label, row.seq, row.step_type, row.tool_name, row.content],
        );
    }

    async listByTask(taskId: string): Promise<SubagentStepRow[]> {
        const r = await this.query<SubagentStepRow>(
            `SELECT * FROM agent_task_subagent_steps WHERE task_id = $1 ORDER BY trace_id, sub_index, seq`,
            [taskId],
        );
        return r.rows;
    }
}
