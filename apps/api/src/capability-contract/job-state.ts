/**
 * 공통 Job 상태 기계 — 전이표가 유일한 규칙이다 (Base·Add-on 통합 P07, 2026-09-23, 계획서 11.2).
 *
 *   queued → submitting → running → collecting → completed
 *                  ↘ submission_unknown (요청은 보냈는데 응답을 못 받음 — 자동 재제출 금지, 중복 과금)
 *   running → cancel_requested → cancelled | running(취소 미지원·거절) | completed(경합: provider 가 먼저 끝냄 — 성공을 덮지 않는다)
 *   running|collecting → blocked_runtime (driver·add-on 버전 불일치 — 보존, 임의 provider 로 재제출 안 함)
 * 종료 상태(completed·cancelled·failed)는 단조다 — 어떤 전이로도 벗어나지 않는다.
 * `manual_review` 는 legacy 행을 새 상태로 해석할 수 없을 때(삭제하지 않고 사람이 본다).
 *
 * @module capability-contract/job-state
 */
export const JOB_STATES = [
    'queued', 'submitting', 'submission_unknown', 'running', 'collecting', 'completed',
    'cancel_requested', 'cancelled', 'failed', 'blocked_runtime', 'manual_review',
] as const;
export type JobState = typeof JOB_STATES[number];

export const TERMINAL_JOB_STATES: ReadonlySet<JobState> = new Set(['completed', 'cancelled', 'failed']);

const TRANSITIONS: Readonly<Record<JobState, readonly JobState[]>> = {
    queued: ['submitting', 'cancelled'],
    submitting: ['running', 'submission_unknown', 'failed'],
    submission_unknown: ['running', 'failed', 'manual_review'],
    running: ['running', 'collecting', 'failed', 'cancel_requested', 'blocked_runtime'],
    collecting: ['collecting', 'completed', 'failed', 'blocked_runtime'],
    cancel_requested: ['cancelled', 'running', 'collecting', 'completed', 'failed'],
    blocked_runtime: ['running', 'collecting', 'failed'],
    manual_review: ['running', 'failed'],
    completed: [],
    cancelled: [],
    failed: [],
};

export function canTransition(from: JobState, to: JobState): boolean {
    return TRANSITIONS[from].includes(to);
}

/** `to` 로 갈 수 있는 출발 상태 전부 — 조건부 UPDATE 의 `state = ANY(...)` 에 쓴다 */
export function sourcesFor(to: JobState): JobState[] {
    return JOB_STATES.filter((s) => canTransition(s, to));
}

/** 종전 `status` 컬럼(pending|completed|failed) — 기존 읽기 경로(listRecent·다음 턴 재조회)가 계속 동작하도록 함께 쓴다 */
export function legacyStatusFor(state: JobState): 'pending' | 'completed' | 'failed' {
    if (state === 'completed') return 'completed';
    if (state === 'failed' || state === 'cancelled') return 'failed';
    return 'pending';
}
