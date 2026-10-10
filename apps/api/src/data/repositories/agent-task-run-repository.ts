/**
 * 에이전트 작업 실행 시작 claim(2026-10-09 점검 ①) — 라우트 /execute·/resume 가 디스패치 직전에 부른다.
 * 주차·부팅 복구 claim 은 agent-task-repository 에 있다(파일 크기 가드로 나눴다).
 *
 * @module data/repositories/agent-task-run-repository
 */
import { BaseRepository } from './base-repository';

export class AgentTaskRunRepository extends BaseRepository {
    /**
     * 실행 시작 claim(2026-10-09 점검 ①) — /execute·/resume 가 디스패치 직전에 부른다. pending/failed/cancelled 에서만
     * 'queued'(디스패치 접수) 로 원자 전이해 같은 작업의 두 번째 요청은 0행 → 호출부가 400. 서비스가 running 으로
     * 올리기 전 창에서도 재claim 이 막히고, 그 창에서 죽어도 부팅 복구가 queued 행을 집는다. 큐가 실제로 대기시키면
     * dispatchAgentTask 의 queued 갱신은 no-op 이다.
     */
    async claimForExecute(taskId: string, opts: { resetProgress: boolean; reason: 'execute claim' | 'resume claim' }): Promise<boolean> {
        const r = await this.query<{ prev: string }>(
            `UPDATE agent_tasks t SET status = 'queued', updated_at = NOW()${opts.resetProgress ? ', progress = 0' : ''}
             FROM (SELECT id, status AS prev FROM agent_tasks WHERE id = $1 FOR UPDATE) o
             WHERE t.id = o.id AND o.prev IN ('pending', 'failed', 'cancelled')
             RETURNING o.prev`,
            [taskId],
        );
        if ((r.rowCount ?? 0) === 0) return false;
        // 전이 이벤트(124) — agent-task-repository.recordEvent 와 같은 fail-open 1행
        await this.query(
            'INSERT INTO agent_task_events (task_id, from_status, to_status, reason) VALUES ($1, $2, $3, $4)',
            [taskId, r.rows[0]?.prev ?? null, 'queued', opts.reason],
        ).catch(() => { /* 이벤트 기록 실패는 작업을 막지 않는다 */ });
        return true;
    }
}
