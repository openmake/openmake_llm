/**
 * 에이전트 작업 승인(HITL) 보강 설정 — 거절 사유·저장본 가림·자동승인의 바닥·무인 실행의 결론.
 * 승인 정책 자체(all/high-risk/none)와 위험 등급표는 `config/task-sandbox`·`config/tool-policy` 에 있다.
 *
 * @module config/agent-task-approval
 */

/** 거절 사유 상한(자) — 넘으면 앞에서 자른다(거절 자체는 막지 않는다). AGENT_TASK_APPROVAL_REJECT_REASON_MAX_CHARS */
export const APPROVAL_REJECT_REASON_MAX_CHARS = parseInt(process.env.AGENT_TASK_APPROVAL_REJECT_REASON_MAX_CHARS || '', 10) || 500;
