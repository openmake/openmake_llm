/**
 * 승인·계획 변경 알림(HITL 2단계 D7) — 이관·에스컬레이션·철회·계획 편집을 받는 사용자의 WS 로
 * `agent_task_progress` 선택 필드(`approvalId`·`reason`)를 실어 보낸다. 받은 쪽 웹·iOS 는 승인함을 재조회한다.
 * 이벤트는 작업의 현재 상태를 함께 실어야 하므로(인라인 카드가 status·progress 로 덮어쓴다) DB 에서 읽는다.
 * fail-open — 알림 실패가 결정·이관 응답을 막지 않는다(승인함은 30초 폴링으로도 따라온다).
 *
 * @module services/agent-task/approval-change-notify
 */
import { getPool } from '../../data/models/unified-database';
import { AgentTaskRepository } from '../../data/repositories/agent-task-repository';
import { emitAgentTaskProgress, type AgentTaskProgressReason } from '../../utils/event-bus';
import { createLogger } from '../../utils/logger';

const logger = createLogger('ApprovalChangeNotify');

export async function notifyApprovalChange(p: {
    userId: string;
    taskId: string;
    reason: AgentTaskProgressReason;
    approvalId?: string;
}): Promise<void> {
    try {
        const task = await new AgentTaskRepository(getPool()).getAgentTask(p.taskId);
        if (!task) return;
        emitAgentTaskProgress({
            userId: p.userId,
            taskId: p.taskId,
            status: task.status,
            progress: task.progress ?? 0,
            currentTurn: task.current_turn ?? 0,
            reason: p.reason,
            ...(p.approvalId ? { approvalId: p.approvalId } : {}),
        });
    } catch (e) {
        logger.warn(`승인 변경 알림 실패(무시): ${p.reason} ${p.taskId} — ${e instanceof Error ? e.message : e}`);
    }
}
