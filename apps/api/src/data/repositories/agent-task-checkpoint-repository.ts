/**
 * 에이전트 작업 턴 재진입 기록 — 턴 체크포인트 이력(141)·도구 호출 저널(124)·실행 중 표식(172).
 * agent-task-repository 가 파일 크기 가드(600줄)에 닿아 이 부분만 나눴다. fork 표시(markForked)는 agent-task-repository 에 있다.
 *
 * @module data/repositories/agent-task-checkpoint-repository
 */
import { BaseRepository } from './base-repository';

export class AgentTaskCheckpointRepository extends BaseRepository {
    /** 턴 체크포인트 이력(141) 1행 + 초과분 정리 — fail-open 은 호출부. */
    async insertCheckpointHistory(taskId: string, turn: number, conversation: unknown[], plan: unknown | null, keep: number): Promise<void> {
        await this.query(
            `INSERT INTO agent_task_checkpoints (task_id, turn, conversation, plan) VALUES ($1, $2, $3::jsonb, $4::jsonb)
             ON CONFLICT (task_id, turn) DO UPDATE SET conversation = EXCLUDED.conversation, plan = EXCLUDED.plan, created_at = NOW()`,
            [taskId, turn, JSON.stringify(conversation), plan == null ? null : JSON.stringify(plan)],
        );
        await this.query(
            `DELETE FROM agent_task_checkpoints WHERE task_id = $1 AND id NOT IN (
                 SELECT id FROM agent_task_checkpoints WHERE task_id = $1 ORDER BY turn DESC LIMIT $2)`,
            [taskId, keep],
        );
    }

    async listCheckpoints(taskId: string): Promise<Array<{ turn: number; messages: number; created_at: string }>> {
        const r = await this.query<{ turn: number; messages: string; created_at: string }>(
            `SELECT turn, jsonb_array_length(conversation)::text AS messages, created_at FROM agent_task_checkpoints WHERE task_id = $1 ORDER BY turn ASC`, [taskId]);
        return r.rows.map((x) => ({ turn: x.turn, messages: Number(x.messages), created_at: x.created_at }));
    }

    async getCheckpoint(taskId: string, turn: number): Promise<{ conversation: unknown[]; plan: unknown | null } | null> {
        const r = await this.query<{ conversation: unknown[]; plan: unknown | null }>(
            'SELECT conversation, plan FROM agent_task_checkpoints WHERE task_id = $1 AND turn = $2', [taskId, turn]);
        return r.rows[0] ?? null;
    }

    /** 도구 호출 저널(124) — tool_call_id → tool_result 본문. 턴 중간 재개가 실행된 호출을 건너뛰는 근거. */
    async getToolCallJournal(taskId: string, toolCallIds: string[]): Promise<Map<string, string>> {
        const r = await this.query<{ tool_call_id: string; content: string | null }>(
            `SELECT tool_call_id, content FROM agent_task_steps
             WHERE task_id = $1 AND step_type = 'tool_result' AND tool_call_id = ANY($2::text[])`,
            [taskId, toolCallIds],
        );
        return new Map(r.rows.map((row) => [row.tool_call_id, row.content ?? '']));
    }

    /** 실행 중 표식(172) — 부작용 도구 실행 직전에 id 를, 결과 스텝 기록 뒤 null 을 쓴다. */
    async setInFlightToolCall(taskId: string, toolCallId: string | null): Promise<void> {
        await this.query(`UPDATE agent_tasks SET in_flight_tool_call_id = $2 WHERE id = $1`, [taskId, toolCallId]);
    }

    async getInFlightToolCall(taskId: string): Promise<string | null> {
        const r = await this.query<{ in_flight_tool_call_id: string | null }>(`SELECT in_flight_tool_call_id FROM agent_tasks WHERE id = $1`, [taskId]);
        return r.rows[0]?.in_flight_tool_call_id ?? null;
    }
}
