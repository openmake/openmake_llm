/**
 * 이어받기 경계 전이 SQL(r6) — 경계 전이(취소, 재시작 중단이 아닌 실패)와 그 전이 이벤트를 한 문장으로 쓴다.
 * agent-task-repository(updateAgentTask)·agent-task-run-repository(실패 닫기)가 같이 쓴다.
 *
 * @module data/repositories/agent-task-event-sql
 */

/** 이어받기 경계가 아닌 실패 사유 — 서버 재시작으로 끊긴 실패는 재개가 결정을 이어받는다(takeoverForCall). */
const RESTART_FAILURE_REASON = 'server restarted';

/** 이어받기 경계 전이인가 — takeoverForCall 이 기준으로 삼는 전이(취소, 재시작 중단이 아닌 실패). */
export function isTakeoverBoundary(to: string, reason: string | null | undefined): boolean {
    return to === 'cancelled' || (to === 'failed' && reason !== RESTART_FAILURE_REASON);
}

/**
 * 경계 전이 + 전이 이벤트를 한 문장으로(r6) — 이벤트는 이어받기 경계라 상태만 바뀌고 이벤트가 빠지면 재시작 뒤 재실행이 취소 전
 * 미소비 승인을 쓴다. 한 문장이라 이벤트 INSERT 가 실패하면 상태 UPDATE 도 함께 실패한다(삼키지 않는다).
 * updateSql 은 `RETURNING o.prev` 로 끝나는 전이 UPDATE. taskId·to·reason 은 SQL 식(파라미터 자리표시자 또는 리터럴).
 * 바뀐 행마다 이벤트 1행 — failed(server restarted)→failed(recovery_limit) 같은 같은 상태 전이도 종전처럼 남긴다(updateAgentTask 의 경계 전이는 표상 자기 전이가 없다). 결과 행은 updateSql 과 같다(prev).
 */
export function withTransitionEventSql(updateSql: string, p: { taskId: string; to: string; reason: string }): string {
    return `WITH u AS (${updateSql}),
         ev AS (INSERT INTO agent_task_events (task_id, from_status, to_status, reason)
                SELECT ${p.taskId}::text, u.prev, ${p.to}::text, ${p.reason}::text FROM u)
         SELECT u.prev FROM u`;
}
