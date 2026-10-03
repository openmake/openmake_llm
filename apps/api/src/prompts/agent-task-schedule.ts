/**
 * 예약 실행 문구 — 사용자에게 보이는 알림·사유, 모델에게 주는 안내.
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

/** "보고할 것 없음" 표식 — 예약 작업의 최종 응답이 이것으로 시작하면 종료 알림을 생략한다(schedule-outcome). */
export const AGENT_TASK_SCHEDULE_SILENT_MARKER = '[NOTHING_TO_REPORT]';

/**
 * 예약 작업의 목표 뒤에 붙이는 안내. 목표에 붙이는 이유: 완료 판정(goal judge)도 목표를 읽으므로
 * 표식만 있는 응답을 "목표가 허용한 답"으로 볼 근거가 된다.
 */
export function getScheduleSilentNote(): string {
    return '\n\n[Scheduled run] This task runs unattended on a schedule. If, after doing the work, there is genuinely '
        + `nothing new worth reporting to the user, reply with exactly ${AGENT_TASK_SCHEDULE_SILENT_MARKER} as your final answer `
        + 'and nothing else. Do not use it to skip the work or to hide a failure.';
}
