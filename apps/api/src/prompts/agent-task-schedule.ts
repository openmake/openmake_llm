/**
 * 예약 실행 문구 — 사용자에게 보이는 알림·사유.
 * @module prompts/agent-task-schedule
 */

const PUSH_GOAL_MAX_CHARS = 50;

/** 예약이 꺼진 사유 — agent_task_schedules.disabled_reason 에 남는다. */
export function getScheduleDisabledReason(failures: number, failureClass: string): string {
    return `실행이 연속 ${failures}회 실패해 자동으로 꺼졌습니다 (${failureClass})`;
}

/** 예약 자동 비활성 알림. */
export function getScheduleDisabledPush(goal: string, failures: number): { title: string; body: string; url: string } {
    return {
        title: 'OpenMake 예약 작업',
        body: `예약 실행이 연속 ${failures}회 실패해 자동으로 꺼졌습니다: ${goal.slice(0, PUSH_GOAL_MAX_CHARS)}`,
        url: '/agent-tasks',
    };
}
