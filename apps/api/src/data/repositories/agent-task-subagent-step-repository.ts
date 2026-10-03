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

/** 주차된 서브에이전트의 재개 지점(173). */
export interface SubagentCheckpointRow {
    task_id: string;
    ckpt_key: string;
    conversation: unknown[];
    turn: number;
    tokens: number;
    trace_id: string | null;
    trace_seq: number;
    /** 기록 시각 — 읽을 때만 채워진다(저장은 DB 가 NOW() 로 적는다). */
    created_at?: Date;
}

export class AgentTaskSubagentStepRepository extends BaseRepository {
    /** 주차 시점의 서브 대화 저장 — 같은 위임이 다시 주차되면 덮어쓴다. */
    async saveCheckpoint(row: SubagentCheckpointRow): Promise<void> {
        await this.query(
            `INSERT INTO agent_task_subagent_checkpoints (task_id, ckpt_key, conversation, turn, tokens, trace_id, trace_seq)
             VALUES ($1, $2, $3::jsonb, $4, $5, $6, $7)
             ON CONFLICT (task_id, ckpt_key) DO UPDATE SET conversation = EXCLUDED.conversation, turn = EXCLUDED.turn,
                 tokens = EXCLUDED.tokens, trace_id = EXCLUDED.trace_id, trace_seq = EXCLUDED.trace_seq, created_at = NOW()`,
            [row.task_id, row.ckpt_key, JSON.stringify(row.conversation).replace(/\\u0000/g, ''), row.turn, row.tokens, row.trace_id, row.trace_seq],
        );
    }

    async loadCheckpoint(taskId: string, ckptKey: string): Promise<SubagentCheckpointRow | null> {
        const r = await this.query<SubagentCheckpointRow>(
            `SELECT task_id, ckpt_key, conversation, turn, tokens, trace_id, trace_seq, created_at
             FROM agent_task_subagent_checkpoints WHERE task_id = $1 AND ckpt_key = $2`,
            [taskId, ckptKey],
        );
        return r.rows[0] ?? null;
    }

    async deleteCheckpoint(taskId: string, ckptKey: string): Promise<void> {
        await this.query(`DELETE FROM agent_task_subagent_checkpoints WHERE task_id = $1 AND ckpt_key = $2`, [taskId, ckptKey]);
    }

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
