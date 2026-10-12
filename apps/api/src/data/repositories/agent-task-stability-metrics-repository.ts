/**
 * 안정화 신호 집계 — 작업 지표(GET /api/agent-tasks/metrics)의 `stability`. 새 테이블 없이 이미 남는 기록에서 센다.
 *
 * 기간 안에 만들어진(created_at) 작업을 대상으로 쿼리 2개:
 * - 전이 이벤트(agent_task_events): 서버 재시작으로 끊긴 실행, 자동 복구(부팅 복구·지난 소유권 점검·로컬 기기 주차),
 *   진행 없는 복구 상한으로 멈춘 것, 모델 서버 장애로 주차한 것, 그리고 대기열 대기(접수 queued 전이 → 바로 다음의 running 전이).
 * - 단계 기록(agent_task_steps): 모델 호출 재시도·빈 응답 되묻기·반복 가드 차단·도구 호출 시간 상한 등
 *   (표지는 config/agent-task-metrics 의 AGENT_TASK_STABILITY_STEP_SIGNALS — 문구는 매개변수로만 넣는다).
 * 행을 가져와 세지 않는다. 실행 방식으로 나누지 않는다(신호 대부분이 서버 쪽 사정이다).
 *
 * @module data/repositories/agent-task-stability-metrics-repository
 */
import { BaseRepository } from './base-repository';
import { AGENT_TASK_STABILITY_STEP_SIGNALS } from '../../config/agent-task-metrics';
import { AGENT_TASK_RECOVERY_LIMIT_ERROR, RECOVERY_CLAIM_REASON } from './agent-task-run-repository';
import { AGENT_TASK_MODEL_WAIT_REASON } from '../../config/agent-task-park-reasons';
import type { AgentTaskStabilityMetrics, AgentTaskStabilitySignal } from '@openmake/shared-types';

type Num = string | number | null | undefined;
type Row = Record<string, Num>;

/** 서버 재시작으로 끊긴 실행의 전이 사유 — shutdown-drain 의 AGENT_TASK_RESTART_ERROR·schema-initializer 의 좀비 정리와 같다 */
const RESTART_REASON = 'server restarted';
/** 전이 이벤트에서 세는 신호(고정 순서) */
const EVENT_SIGNAL_IDS = ['restart_interrupt', 'recovery', 'recovery_limit', 'model_wait'] as const;

const EVENT_SQL = `
WITH t AS (
    SELECT id FROM agent_tasks WHERE created_at >= NOW() - make_interval(days => $1)
), e AS (
    SELECT e.task_id, e.to_status, e.reason, e.created_at,
           LAG(e.to_status) OVER w AS prev_to, LAG(e.created_at) OVER w AS prev_at
      FROM agent_task_events e JOIN t ON t.id = e.task_id
    WINDOW w AS (PARTITION BY e.task_id ORDER BY e.id)
)
SELECT COUNT(*) FILTER (WHERE to_status = 'failed' AND reason = $2) AS restart_interrupt_n,
       COUNT(DISTINCT task_id) FILTER (WHERE to_status = 'failed' AND reason = $2) AS restart_interrupt_t,
       COUNT(*) FILTER (WHERE reason = $3) AS recovery_n,
       COUNT(DISTINCT task_id) FILTER (WHERE reason = $3) AS recovery_t,
       COUNT(*) FILTER (WHERE to_status = 'failed' AND reason = $4) AS recovery_limit_n,
       COUNT(DISTINCT task_id) FILTER (WHERE to_status = 'failed' AND reason = $4) AS recovery_limit_t,
       COUNT(*) FILTER (WHERE reason = $5) AS model_wait_n,
       COUNT(DISTINCT task_id) FILTER (WHERE reason = $5) AS model_wait_t,
       COUNT(*) FILTER (WHERE to_status = 'running' AND prev_to = 'queued') AS starts,
       percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (created_at - prev_at)) * 1000)
           FILTER (WHERE to_status = 'running' AND prev_to = 'queued') AS start_wait_p50_ms,
       percentile_cont(0.95) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (created_at - prev_at)) * 1000)
           FILTER (WHERE to_status = 'running' AND prev_to = 'queued') AS start_wait_p95_ms
  FROM e`;

/** 단계 신호 집계문과 매개변수 — $1 기간, $2 스텝 종류 목록, 그 뒤로 신호마다 종류(·LIKE 문구). */
function buildStepQuery(days: number): { sql: string; params: Array<string | number | string[]> } {
    const params: Array<string | number | string[]> = [days, [...new Set(AGENT_TASK_STABILITY_STEP_SIGNALS.map((s) => s.stepType))]];
    const cols = AGENT_TASK_STABILITY_STEP_SIGNALS.map((s) => {
        params.push(s.stepType);
        let cond = `s.step_type = $${params.length}`;
        if (s.like !== undefined) { params.push(s.like); cond += ` AND s.content LIKE $${params.length}`; }
        return `COUNT(*) FILTER (WHERE ${cond}) AS ${s.id}_n, COUNT(DISTINCT s.task_id) FILTER (WHERE ${cond}) AS ${s.id}_t`;
    });
    const sql = `
SELECT ${cols.join(',\n       ')}
  FROM agent_task_steps s
  JOIN agent_tasks t ON t.id = s.task_id
 WHERE t.created_at >= NOW() - make_interval(days => $1) AND s.step_type = ANY($2::text[])`;
    return { sql, params };
}

const int = (v: Num): number => (v === null || v === undefined ? 0 : Math.round(Number(v)));
const intOrNull = (v: Num): number | null => (v === null || v === undefined ? null : Math.round(Number(v)));
const signalOf = (row: Row, id: string): AgentTaskStabilitySignal => ({ id, occurrences: int(row[`${id}_n`]), tasks: int(row[`${id}_t`]) });

export class AgentTaskStabilityMetricsRepository extends BaseRepository {
    async getStability(days: number): Promise<AgentTaskStabilityMetrics> {
        const step = buildStepQuery(days);
        const [events, steps] = await Promise.all([
            this.query<Row>(EVENT_SQL, [days, RESTART_REASON, RECOVERY_CLAIM_REASON, AGENT_TASK_RECOVERY_LIMIT_ERROR, AGENT_TASK_MODEL_WAIT_REASON]),
            this.query<Row>(step.sql, step.params),
        ]);
        const ev = events.rows[0] ?? {};
        const st = steps.rows[0] ?? {};
        return {
            signals: [
                ...EVENT_SIGNAL_IDS.map((id) => signalOf(ev, id)),
                ...AGENT_TASK_STABILITY_STEP_SIGNALS.map((s) => signalOf(st, s.id)),
            ],
            queueWait: { starts: int(ev.starts), p50Ms: intOrNull(ev.start_wait_p50_ms), p95Ms: intOrNull(ev.start_wait_p95_ms) },
        };
    }
}
