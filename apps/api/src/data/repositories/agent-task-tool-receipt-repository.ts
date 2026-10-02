/**
 * 외부 도구 실행 영수증 저장소 (175) — services/agent-task/tool-receipt 가 쓴다.
 *
 * @module data/repositories/agent-task-tool-receipt-repository
 */
import { BaseRepository } from './base-repository';

export class AgentTaskToolReceiptRepository extends BaseRepository {
    /** 외부 도구 실행 영수증(175) — 시작 기록. 같은 호출의 재실행이면 started 로 되돌리고 시도 횟수를 올린다. */
    async startToolReceipt(r: { taskId: string; toolCallId: string; toolName: string; argsHash: string; idempotencyKey: string }): Promise<void> {
        await this.query(
            `INSERT INTO agent_task_tool_receipts (task_id, tool_call_id, tool_name, args_hash, idempotency_key)
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (task_id, tool_call_id) DO UPDATE
                SET status = 'started', attempts = agent_task_tool_receipts.attempts + 1, started_at = NOW(), finished_at = NULL`,
            [r.taskId, r.toolCallId, r.toolName, r.argsHash, r.idempotencyKey]);
    }

    /** 외부 도구 실행 영수증(175) — 종료 기록. 영수증이 없는 호출(대상 아님·기록 실패)은 0행 갱신으로 끝난다. */
    async finishToolReceipt(taskId: string, toolCallId: string, status: string): Promise<void> {
        await this.query(
            `UPDATE agent_task_tool_receipts SET status = $3, finished_at = NOW() WHERE task_id = $1 AND tool_call_id = $2`,
            [taskId, toolCallId, status]);
    }
}
