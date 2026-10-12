/**
 * 관리자 작업 지표(GET /api/agent-tasks/metrics) 상수 — Companion P5 측정 장치.
 *
 * @module config/agent-task-metrics
 */

export const AGENT_TASK_METRICS = {
    /** 기본 조회 기간(일). */
    DEFAULT_DAYS: 7,
    /** 조회 기간 상한(일) — 이보다 길면 400. */
    MAX_DAYS: 90,
    /** 화면의 기간 선택지(일). */
    DAY_OPTIONS: [7, 30, 90] as readonly number[],
    /** 실패 사유 상위 N. */
    FAILURE_TOP_N: 5,
} as const;

/** 안정화 신호 하나 — 단계 기록(agent_task_steps)에서 알아보는 스텝 종류와 SQL LIKE 문구(없으면 종류만으로 센다). */
export interface AgentTaskStabilityStepSignal {
    /** 응답·화면 문구의 키. 소문자·밑줄만(SQL 별칭으로 쓴다). */
    id: string;
    stepType: string;
    like?: string;
}

/**
 * 안정화 신호(작업 지표 화면의 "안정화 신호") 중 단계 기록에서 세는 것. 문구의 원본은 prompts/agent-task-*.ts 와
 * AgentTaskService 의 retry 스텝이고, 여기에는 변하지 않는 부분만 LIKE 로 둔다 — 원본을 바꾸면
 * `__tests__/agent-task-stability-signals.test.ts` 가 깨진다(그때 여기도 고친다). 문구를 바꾸기 전의 기록은 새 표지에 잡히지 않는다.
 * 전이 이벤트에서 세는 신호(재시작 중단·자동 복구·복구 상한)는 저장소(agent-task-stability-metrics-repository)에 있다.
 */
export const AGENT_TASK_STABILITY_STEP_SIGNALS: readonly AgentTaskStabilityStepSignal[] = [
    { id: 'llm_retry', stepType: 'retry', like: '일시적 LLM 오류 — 재시도%' },
    { id: 'llm_recovery_wait', stepType: 'retry', like: '%짧은 재시도 소진%' },
    { id: 'empty_response_retry', stepType: 'retry', like: '빈 응답 — 되묻기%' },
    { id: 'loop_guard_block', stepType: 'tool_result', like: 'Error: 이 호출(%번 연속%실행하지 않았습니다%' },
    { id: 'tool_call_timeout', stepType: 'tool_result', like: 'Error: %시간 상한으로 기다리기를 멈췄습니다%' },
    { id: 'context_trim', stepType: 'context_trim' },
    { id: 'output_repetition', stepType: 'output_repetition' },
];
