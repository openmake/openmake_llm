/**
 * 예약 발화 판단 — 발화 멱등 키와 이전 실행 겹침 판정(순수 함수).
 *
 * - 멱등 키: 작업 생성 뒤 발화 기록(markRun) 전에 서버가 죽으면 재시작 뒤 같은 발화가 다시 나갔다.
 *   예약 id + 예정 시각을 작업 생성 멱등 키로 넘기면 두 번째 생성은 아무것도 만들지 않는다.
 * - 겹침: 이전 실행이 아직 돌고 있으면 이번 발화를 건너뛴다(같은 리포트 중복 생성·게시 파일 덮어쓰기 방지).
 *
 * @module services/agent-task/schedule-fire
 */

/** 아직 끝나지 않은 작업 상태. */
const ACTIVE_STATUSES: ReadonlySet<string> = new Set(['pending', 'queued', 'running', 'paused']);

/** PURE: 발화 하나를 가리키는 키 — 예약 id + 예정 시각(ISO). */
export function scheduleFireKey(scheduleId: string, nextRunAt: string | Date): string {
    const at = nextRunAt instanceof Date ? nextRunAt : new Date(nextRunAt);
    return `sched:${scheduleId}:${Number.isNaN(at.getTime()) ? String(nextRunAt) : at.toISOString()}`;
}

/**
 * PURE: 이전 실행이 아직 도는가. 진행 중 상태로 남았어도 staleMs 넘게 갱신이 없으면 멈춘 표시로 보고 거짓 —
 * 그렇지 않으면 정리되지 않은 작업 하나가 예약을 영영 막는다.
 */
export function isPreviousRunActive(
    last: { status?: string | null; updatedAt?: Date | string | null } | null | undefined, nowMs: number, staleMs: number,
): boolean {
    if (!last?.status || !ACTIVE_STATUSES.has(last.status)) return false;
    const updated = last.updatedAt ? new Date(last.updatedAt).getTime() : NaN;
    return Number.isNaN(updated) || nowMs - updated <= staleMs;
}
