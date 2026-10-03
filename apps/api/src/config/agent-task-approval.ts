/**
 * 에이전트 작업 승인(HITL) 보강 설정 — 거절 사유·저장본 가림·자동승인의 바닥·무인 실행의 결론.
 * 승인 정책 자체(all/high-risk/none)와 위험 등급표는 `config/task-sandbox`·`config/tool-policy` 에 있다.
 *
 * @module config/agent-task-approval
 */

/** 거절 사유 상한(자) — 넘으면 앞에서 자른다(거절 자체는 막지 않는다). AGENT_TASK_APPROVAL_REJECT_REASON_MAX_CHARS */
export const APPROVAL_REJECT_REASON_MAX_CHARS = parseInt(process.env.AGENT_TASK_APPROVAL_REJECT_REASON_MAX_CHARS || '', 10) || 500;

/**
 * 승인 저장본(승인함에 보이는 인자·미리보기 사본)의 비밀 값 가림 — 기본 켜짐.
 * 실행과 호출 결속은 원래 인자를 쓰므로 가려도 달라지지 않는다. AGENT_TASK_APPROVAL_REDACT_ARGS=false 로 끈다.
 */
export const APPROVAL_REDACT_STORED_ARGS = process.env.AGENT_TASK_APPROVAL_REDACT_ARGS !== 'false';
