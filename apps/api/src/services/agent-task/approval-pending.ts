/**
 * 승인 대기 진입 알림 — 부모 턴의 승인(turn-executor)과 delegate 서브에이전트 안의 승인이 같은 발행을 쓴다.
 *
 * @module services/agent-task/approval-pending
 */
import { getUnifiedDatabase } from '../../data/models/unified-database';
import { getPushService } from '../PushService';
import type { TaskRuntime } from '../task-sandbox/runtime';

type AgentTaskUpdatePayload = Parameters<ReturnType<typeof getUnifiedDatabase>['updateAgentTask']>[1];

interface ApprovalPendingContext {
    userId: string;
    taskId: string;
    update: (u: AgentTaskUpdatePayload) => Promise<void>;
    taskRuntime: Pick<TaskRuntime, 'notifyApprovalPending'> | null;
}

/**
 * status='paused' + 알림. 알림은 두 채널: 웹 푸시(설정에서 켠 사용자만 — 운영 구독 0건이던 opt-in) + 로컬 실행 작업이면
 * 실행 디바이스(컴패니언 네이티브 알림, 2026-09-11). 링크는 작업 상세로 바로 연다.
 */
export function notifyApprovalPending(c: ApprovalPendingContext, toolName: string): void {
    void c.update({ status: 'paused' }).catch(() => { /* noop */ });
    void getPushService().sendPush(c.userId, {
        title: 'OpenMake 에이전트 — 승인 필요',
        body: `도구 실행 승인을 기다립니다: ${toolName}`,
        url: `/agent-tasks?task=${encodeURIComponent(c.taskId)}`,
    }).catch(() => { /* noop */ });
    try { c.taskRuntime?.notifyApprovalPending(toolName); } catch { /* 알림 실패는 작업에 영향 없음 */ }
}

/**
 * delegate 서브에이전트 안의 승인 대기 훅 — 유예 안에서도 부모 턴의 승인처럼 부모를 paused 로 두고,
 * 결정(승인·거절)이 나면 running 으로 되돌린다. 주차되면 결정 훅이 불리지 않아 paused 로 남는다.
 */
export function buildSubagentApprovalHooks(p: Omit<ApprovalPendingContext, 'taskRuntime'> & {
    getCurStatus: () => string;
    /** 런타임은 delegate 팩토리보다 늦게 만들어진다 — 호출 시점에 읽는다. */
    getTaskRuntime: () => ApprovalPendingContext['taskRuntime'];
}): { onApprovalPending: (toolName: string) => void; onApprovalDecided: () => void } {
    return {
        onApprovalPending: (toolName) => notifyApprovalPending({ userId: p.userId, taskId: p.taskId, update: p.update, taskRuntime: p.getTaskRuntime() }, toolName),
        onApprovalDecided: () => {
            if (p.getCurStatus() === 'paused') void p.update({ status: 'running' }).catch(() => { /* noop */ });
        },
    };
}
