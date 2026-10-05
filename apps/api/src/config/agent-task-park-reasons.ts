/**
 * 에이전트 작업 주차 사유 — agent_task_events.reason 값. 마지막 전이 이벤트가 이 사유인 paused 작업이 주차 중이다.
 * 주차된 작업은 실행을 끝내 대기열 자리를 반납하고, 부팅 복구·좀비 마킹의 대상에서 빠진다(저장소 parkedTaskCondition).
 *
 * @module config/agent-task-park-reasons
 */

/** 질문 응답 대기(F16.7) — 질문형 승인이 만료돼 답을 기다린다(agent-task/hitl-park). */
export const AGENT_TASK_PARKED_REASON = 'hitl_parked';

/** 기기 대기(Companion P1-4) — 로컬 실행 작업이 쓸 기기가 연결돼 있지 않다(agent-task/device-wait). */
export const AGENT_TASK_DEVICE_WAIT_REASON = 'device_wait';

/** 브라우저 넘겨받기(2026-10-05) — 사용자가 Companion 에서 브라우저를 넘겨받아 기기가 브라우저 요청을 거절했다(agent-task/browser-takeover). */
export const AGENT_TASK_BROWSER_TAKEOVER_REASON = 'browser_takeover';

/** 주차로 취급하는 사유 전부 */
export const AGENT_TASK_PARK_REASONS: readonly string[] = [AGENT_TASK_PARKED_REASON, AGENT_TASK_DEVICE_WAIT_REASON, AGENT_TASK_BROWSER_TAKEOVER_REASON];
