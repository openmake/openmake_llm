/**
 * Agent Task 상태 머신 — 허용 전이표 (Durable Task Runtime 1단계).
 *
 * 종전엔 status 가 약 10곳(서비스 루프·finalize·큐·라우트·부팅 복구·스키마 초기화)에서 조건 없이
 * UPDATE 됐다. 이 표가 유일한 규칙이고 AgentTaskRepository.updateAgentTask 가 강제한다 —
 * 표 밖 전이는 거부(throw)되고, 허용 전이는 agent_task_events 에 남는다.
 *
 * 전이 출처(실경로에서 도출 — 새 경로가 생기면 여기에 먼저 적을 것):
 *   pending  → queued(큐 대기) · running(실행 시작) · cancelled(실행 전 취소) · failed(시작 실패)
 *   queued   → running · pending(부팅 복구 claim) · cancelled · failed
 *   running  → paused(승인 대기) · completed · failed · cancelled · pending(복구 claim)
 *   paused   → running(승인 해소) · completed · failed · cancelled · pending(복구 claim)
 *   failed   → pending(재실행 전 리셋·복구 claim) · queued · running(resume) · cancelled
 *   cancelled→ pending · queued · running(resume)
 *   completed→ (없음 — 라우트가 재실행·재개를 400 으로 막는다)
 * 같은 상태로의 갱신은 no-op(허용, 이벤트 없음).
 *
 * @module services/agent-task/task-state
 */
import type { AgentTaskStatus } from '../../data/models/unified-database.types';

const ALLOWED_TRANSITIONS: Readonly<Record<AgentTaskStatus, readonly AgentTaskStatus[]>> = {
    pending: ['queued', 'running', 'cancelled', 'failed'],
    queued: ['running', 'pending', 'cancelled', 'failed'],
    running: ['paused', 'completed', 'failed', 'cancelled', 'pending'],
    paused: ['running', 'completed', 'failed', 'cancelled', 'pending'],
    failed: ['pending', 'queued', 'running', 'cancelled'],
    cancelled: ['pending', 'queued', 'running'],
    completed: [],
};

export const AGENT_TASK_STATUSES: readonly AgentTaskStatus[] = Object.keys(ALLOWED_TRANSITIONS) as AgentTaskStatus[];

/** PURE: from → to 전이 허용 여부. from === to 는 항상 허용(no-op). */
export function isTransitionAllowed(from: AgentTaskStatus, to: AgentTaskStatus): boolean {
    return from === to || ALLOWED_TRANSITIONS[from].includes(to);
}

/** PURE: `to` 로 갈 수 있는 출발 상태 목록(자기 자신 포함) — 조건부 UPDATE 의 WHERE 절 재료. */
export function allowedSources(to: AgentTaskStatus): AgentTaskStatus[] {
    return AGENT_TASK_STATUSES.filter((from) => isTransitionAllowed(from, to));
}

/** 표 밖 전이 시도 — 호출부 결함(또는 경쟁 전이)이므로 조용히 넘기지 않는다. */
export class AgentTaskTransitionError extends Error {
    constructor(public readonly taskId: string, public readonly from: string, public readonly to: AgentTaskStatus) {
        super(`agent_tasks 상태 전이 거부: ${taskId} ${from} → ${to}`);
        this.name = 'AgentTaskTransitionError';
    }
}
