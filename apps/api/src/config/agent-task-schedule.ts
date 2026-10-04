/**
 * 예약 실행(agent_task_schedules) 설정 — 실행 결과 반영, 모델 미도달 재실행, "보고할 것 없음" 선언.
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
    /** 모델에 닿지 못한 실행(모델 응답 0회 + 연결 실패·5xx)을 다음 주기 전에 다시 돌린다.
     *  AGENT_TASK_SCHEDULE_UNREACHABLE_RETRY_ENABLED=false 로 끈다. 실행 결과 반영이 꺼져 있으면 함께 꺼진다. */
    UNREACHABLE_RETRY_ENABLED: process.env.AGENT_TASK_SCHEDULE_UNREACHABLE_RETRY_ENABLED !== 'false',
    /** 재실행 대기(ms) — 실패한 때부터 5·15·30분 뒤, 이 길이가 곧 최대 횟수(3회). 모델 서버 재기동이 보통 이 안에 끝난다. */
    UNREACHABLE_RETRY_DELAYS_MS: [5 * 60_000, 15 * 60_000, 30 * 60_000] as readonly number[],
    /**
     * "보고할 것 없음" 선언 — 예약 작업의 최종 응답이 표식(prompts/agent-task-schedule)으로 시작하면 종료 알림을 생략한다.
     * AGENT_TASK_SCHEDULE_SILENT_ENABLED=false 로 끈다. 실행 결과 반영(RUN_OUTCOME_ENABLED)이 꺼져 있으면 동작하지 않는다.
     *
     * 기본 켜짐의 근거(2026-10-04 실측, retired-chat-model, 샌드박스 — 예약 실행과 같은 형태: 목표 + 안내, 무인, 승인 없음):
     * 작업 공간 파일로 상황을 고정한 목표 10종을 각 2회 돌렸다(다른 프로세스의 좀비 정리에 걸린 3건은 빼고 그 조건을 다시 돌려
     * 유효 21건). 보고할 것이 있는 상황 5종(로그의 오류·재고 부족·가격 변경·무조건 요약·입력 파일 없음) 11건에서 표식을 쓴 것은
     * 0건 — 입력 파일이 없는 경우에도 표식으로 숨기지 않고 없다고 보고했다. 보고할 변화가 없는 상황 5종 10건에서는 5건이 표식을 썼고
     * (나머지 5건은 "해당 없음"을 글로 답해 종전처럼 알림이 나간다). 표식뿐인 응답 5건은 완료 판정이 모두 완료로 받았다.
     * 남용 0/11 은 표본이 작다(실제 남용률이 0 이라는 뜻이 아니다) — 알림이 사라졌다는 신고가 오면 먼저 이 값을 끈다.
     */
    SILENT_ENABLED: process.env.AGENT_TASK_SCHEDULE_SILENT_ENABLED !== 'false',
    /** fork 때 모델 응답에 대한 되묻기(빈 응답·검증 실패·stuck·행동 예고 재촉)도 대화에서 뺀다(one-shot-notice).
     *  AGENT_TASK_FORK_STRIP_REPLY_NUDGES_ENABLED=false 로 끈다(종전: 일회성 자원 안내만 뺀다). */
    FORK_STRIP_REPLY_NUDGES_ENABLED: process.env.AGENT_TASK_FORK_STRIP_REPLY_NUDGES_ENABLED !== 'false',
} as const;

/** 모델에 닿지 못한 오류 문구 — 연결 실패와 5xx 만. 4xx·시간 초과·목표 미달성은 다시 돌려도 같다. */
export const SCHEDULE_UNREACHABLE_ERROR_RE = /connection error|econnrefused|econnreset|enotfound|socket hang up|fetch failed|^terminated\b|other side closed|internalservererror|^5\d\d\b/i;

/** 실패로 세지 않는 분류 — 서버 재시작 같은 중단은 예약 탓이 아니다. */
export const SCHEDULE_UNCOUNTED_FAILURE_CLASSES: ReadonlySet<AgentTaskFailureClass> = new Set<AgentTaskFailureClass>(['interrupted']);
