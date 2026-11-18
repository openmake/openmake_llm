/**
 * 승인 레지스트리 ↔ 동시성 큐 포트 — 재개 가능한 승인 대기 동안 실행 슬롯을 양보하고 결정 때 되찾는다.
 * 레지스트리(task-sandbox)는 이 4개 메서드로만 큐를 만진다. hitl-park 는 다른 호출부처럼 동적 import(순환 방지).
 * @module services/agent-task/approval-slot-port
 */
import { getAgentTaskQueue } from './task-queue';

export interface ApprovalSlotPort {
    /** 승인 대기 진입 — 슬롯 양보(큐에 없는 작업은 무시). */
    yieldSlot(taskId: string): void;
    /** 결정 — 자리가 있으면 되찾고 true, 없으면 false(호출부가 결정을 저장하고 주차). */
    tryReclaimSlot(taskId: string): boolean;
    /** 결정 저장 실패 — 상한을 보지 않고 되찾는다(결정이 메모리에만 있어 지금 써야 한다). */
    forceReclaimSlot(taskId: string): void;
    /** 주차로 넘긴 결정 — 이 실행이 자리를 반납한 직후 주차 재개를 한 번 시도한다. */
    resumeAfterRelease(taskId: string): void;
}

export const queueApprovalSlotPort: ApprovalSlotPort = {
    yieldSlot: (taskId) => getAgentTaskQueue().yieldSlot(taskId),
    tryReclaimSlot: (taskId) => getAgentTaskQueue().tryReclaimSlot(taskId),
    forceReclaimSlot: (taskId) => getAgentTaskQueue().forceReclaimSlot(taskId),
    resumeAfterRelease: (taskId) => getAgentTaskQueue().retryAfterRelease(taskId, async () => {
        const { resumeParkedTask } = await import('./hitl-park');
        return resumeParkedTask(taskId);
    }),
};
