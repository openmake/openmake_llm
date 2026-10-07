/**
 * 관리자 작업 지표 API 계약 (Companion P5 측정 장치, 2026-10-06).
 * GET /api/agent-tasks/metrics?days=7 — 응답은 공통 `{ success, data }` 봉투 안의 data 모양이다.
 * 기간 안에 만들어진(created_at) 작업을 실행 방식(executor)별로 집계하고, 전체 합계를 따로 싣는다.
 */

/** 한 묶음(실행 방식 하나 또는 전체)의 집계. 비율·평균·백분위는 대상이 0건이면 null. */
export interface AgentTaskMetricsGroup {
  /** 'sandbox'(서버 샌드박스) | 'local'(사용자 기기) 등 agent_tasks.executor 값. 전체 합계는 null. */
  executor: string | null;
  /** 추론 수준별 묶음(184)에서만 채운다: 'off' | 'low' | 'medium' | 'high'. 실행 방식별·전체 묶음은 undefined. */
  thinkingLevel?: string | null;
  total: number;
  completed: number;
  failed: number;
  cancelled: number;
  /** 아직 끝나지 않은 작업(pending·queued·running·paused). */
  inProgress: number;
  /** completed / (completed + failed + cancelled). */
  successRate: number | null;
  /** 끝난 작업의 소요 시간(첫 running 전이 → completed_at, 전이 기록이 없으면 created_at 부터) ms. */
  durationP50Ms: number | null;
  durationP95Ms: number | null;
  /** total_tokens 가 기록된 작업 수와 그 평균·합계. */
  tokenTasks: number;
  tokensAvg: number | null;
  tokensSum: number;
  /** 캐시 적중 프롬프트 토큰 합계(cached_prompt_tokens, 기록된 작업만). */
  cachedPromptTokensSum: number;
  /** 승인 요청 수(질문 도구 제외)·질문(ask_human·mcp_elicit) 수 — agent_task_approvals. */
  approvalRequests: number;
  questions: number;
  /** 주차 이벤트 수 — agent_task_events.reason. */
  deviceWaits: number;
  browserTakeovers: number;
  /** 작업당 사용자 개입(승인 요청 + 질문 + 기기 대기 + 넘겨받기) 평균. */
  interventionsPerTask: number | null;
}

export interface AgentTaskFailureCount {
  /** config/agent-task-failure-class 의 분류, 기록이 없으면 'unknown'. */
  failureClass: string;
  count: number;
}

export interface AgentTaskMetricsResponse {
  days: number;
  /** 화면의 기간 선택지와 상한(config). */
  dayOptions: number[];
  maxDays: number;
  overall: AgentTaskMetricsGroup;
  byExecutor: AgentTaskMetricsGroup[];
  /** 추론 수준별(184) — 항상 off·low·medium·high 네 묶음, 그 순서. 기존 행(NULL)은 off 로 센다. */
  byThinkingLevel: AgentTaskMetricsGroup[];
  /** 실패 사유 상위 N(전체 기준). */
  topFailures: AgentTaskFailureCount[];
}
