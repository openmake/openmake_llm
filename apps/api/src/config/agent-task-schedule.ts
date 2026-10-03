/**
 * 예약 실행(agent_task_schedules) 설정 — 실행 결과 반영.
 *
 * 종전에는 제출 실패만 연속 실패로 세어, 매번 실행에 실패하는 예약이 꺼지지 않고 알림이 매회 나갔다.
 * 예약이 만든 작업의 종료 결과를 예약에 되돌려 같은 실패는 한 번만 알리고, 연속으로 실패하면 끈다.
 *
 * @module config/agent-task-schedule
 */
import type { AgentTaskFailureClass } from './agent-task-failure-class';

export const AGENT_TASK_SCHEDULE = {
    /** 실행 결과를 예약에 반영한다. AGENT_TASK_SCHEDULE_RUN_OUTCOME_ENABLED=false 로 끈다(종전: 제출 실패만 센다). */
    RUN_OUTCOME_ENABLED: process.env.AGENT_TASK_SCHEDULE_RUN_OUTCOME_ENABLED !== 'false',
    /** 실행이 연속으로 이 횟수만큼 실패하면 예약을 끈다. 제출 실패 임계(기본 5)와 같은 값에서 시작한다.
     *  AGENT_TASK_SCHEDULE_RUN_FAILURE_DISABLE_AFTER(기본 5). */
    RUN_FAILURE_DISABLE_AFTER: parseInt(process.env.AGENT_TASK_SCHEDULE_RUN_FAILURE_DISABLE_AFTER || '', 10) || 5,
    /** 오류 서명에 쓰는 오류 문구 길이 — 앞부분만 비교해 요청 id 같은 꼬리 차이를 무시한다. */
    SIGNATURE_ERROR_CHARS: 120,
} as const;

/** 실패로 세지 않는 분류 — 서버 재시작 같은 중단은 예약 탓이 아니다. */
export const SCHEDULE_UNCOUNTED_FAILURE_CLASSES: ReadonlySet<AgentTaskFailureClass> = new Set<AgentTaskFailureClass>(['interrupted']);
