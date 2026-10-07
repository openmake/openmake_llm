/**
 * 작업 지표 집계 — Companion P5(업무 UX·모델 품질)의 측정 장치. GET /api/agent-tasks/metrics 가 쓴다.
 *
 * 기간 안에 만들어진(created_at) 작업을 실행 방식(executor)별로, 그리고 전체로(GROUPING SETS) 한 쿼리에 집계하고,
 * 실패 사유 상위 N 을 두 번째 쿼리로 센다. 행을 가져와 JS 로 세지 않는다(기간이 길어도 결과 행은 실행 방식 수 + 1).
 * 추론 수준별 집계는 같은 모양의 세 번째 쿼리.
 *
 * - 소요 시간: 첫 running 전이(agent_task_events) → completed_at. 전이 기록이 없으면 created_at 부터(대기 포함).
 * - 승인 요청·질문: agent_task_approvals 행 수. 질문 도구(HITL_ALWAYS_WAIT_TOOLS)면 질문, 나머지는 승인 요청.
 * - 기기 대기·넘겨받기: agent_task_events.reason 이 해당 주차 사유인 이벤트 수.
 *
 * 기존 AgentTaskMetricsRepository 는 도구 오류 신호 집계(ops-metrics)라 별도 파일로 둔다.
 *
 * @module data/repositories/agent-task-outcome-metrics-repository
 */
import { BaseRepository } from './base-repository';
import { HITL_ALWAYS_WAIT_TOOLS } from '../../config/tool-policy';
import { AGENT_TASK_DEVICE_WAIT_REASON, AGENT_TASK_BROWSER_TAKEOVER_REASON } from '../../config/agent-task-park-reasons';
import type { AgentTaskFailureCount, AgentTaskMetricsGroup } from '@openmake/shared-types';

type Num = string | number | null;
interface GroupRow {
    executor: string | null; is_total: boolean;
    thinking_level?: string | null;
    total: Num; completed: Num; failed: Num; cancelled: Num; in_progress: Num;
    duration_p50_ms: Num; duration_p95_ms: Num;
    token_tasks: Num; tokens_avg: Num; tokens_sum: Num; cached_prompt_tokens_sum: Num;
    approval_requests: Num; questions: Num; device_waits: Num; browser_takeovers: Num;
}

const GROUP_SQL = `
WITH t AS (
    SELECT t.id, t.executor, t.status, t.created_at, t.completed_at, t.total_tokens, t.cached_prompt_tokens,
           (SELECT MIN(e.created_at) FROM agent_task_events e WHERE e.task_id = t.id AND e.to_status = 'running') AS started_at
      FROM agent_tasks t
     WHERE t.created_at >= NOW() - make_interval(days => $1)
), ap AS (
    SELECT a.task_id,
           COUNT(*) FILTER (WHERE NOT (a.tool_name = ANY($2::text[]))) AS approval_requests,
           COUNT(*) FILTER (WHERE a.tool_name = ANY($2::text[])) AS questions
      FROM agent_task_approvals a JOIN t ON t.id = a.task_id
     GROUP BY a.task_id
), ev AS (
    SELECT e.task_id,
           COUNT(*) FILTER (WHERE e.reason = $3) AS device_waits,
           COUNT(*) FILTER (WHERE e.reason = $4) AS browser_takeovers
      FROM agent_task_events e JOIN t ON t.id = e.task_id
     WHERE e.reason IN ($3, $4)
     GROUP BY e.task_id
)
SELECT t.executor,
       GROUPING(t.executor) = 1 AS is_total,
       COUNT(*) AS total,
       COUNT(*) FILTER (WHERE t.status = 'completed') AS completed,
       COUNT(*) FILTER (WHERE t.status = 'failed') AS failed,
       COUNT(*) FILTER (WHERE t.status = 'cancelled') AS cancelled,
       COUNT(*) FILTER (WHERE t.status NOT IN ('completed', 'failed', 'cancelled')) AS in_progress,
       percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (t.completed_at - COALESCE(t.started_at, t.created_at))) * 1000)
           FILTER (WHERE t.status IN ('completed', 'failed', 'cancelled') AND t.completed_at IS NOT NULL) AS duration_p50_ms,
       percentile_cont(0.95) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (t.completed_at - COALESCE(t.started_at, t.created_at))) * 1000)
           FILTER (WHERE t.status IN ('completed', 'failed', 'cancelled') AND t.completed_at IS NOT NULL) AS duration_p95_ms,
       COUNT(t.total_tokens) AS token_tasks,
       AVG(t.total_tokens) AS tokens_avg,
       SUM(t.total_tokens) AS tokens_sum,
       SUM(t.cached_prompt_tokens) AS cached_prompt_tokens_sum,
       SUM(ap.approval_requests) AS approval_requests,
       SUM(ap.questions) AS questions,
       SUM(ev.device_waits) AS device_waits,
       SUM(ev.browser_takeovers) AS browser_takeovers
  FROM t
  LEFT JOIN ap ON ap.task_id = t.id
  LEFT JOIN ev ON ev.task_id = t.id
 GROUP BY GROUPING SETS ((t.executor), ())
 ORDER BY is_total, t.executor`;

/** 추론 수준별(184) — GROUP_SQL 과 같은 집계를 수준 키로. NULL 은 off. 전체 합계는 GROUP_SQL 이 이미 준다. */
const THINKING_SQL = GROUP_SQL
    .replace('SELECT t.executor,\n       GROUPING(t.executor) = 1 AS is_total,', "SELECT COALESCE(t.thinking_level, 'off') AS thinking_level,\n       false AS is_total,")
    .replace('SELECT t.id, t.executor, t.status,', 'SELECT t.id, t.executor, t.thinking_level, t.status,')
    .replace(' GROUP BY GROUPING SETS ((t.executor), ())\n ORDER BY is_total, t.executor', " GROUP BY COALESCE(t.thinking_level, 'off')");
if (!THINKING_SQL.includes("COALESCE(t.thinking_level, 'off') AS thinking_level") || THINKING_SQL.includes('GROUPING SETS')) {
    throw new Error('THINKING_SQL 치환 실패 — GROUP_SQL 의 SELECT/GROUP BY 문구가 바뀌었다');
}

const FAILURE_SQL = `
SELECT COALESCE(failure_class, 'unknown') AS failure_class, COUNT(*) AS count
  FROM agent_tasks
 WHERE status = 'failed' AND created_at >= NOW() - make_interval(days => $1)
 GROUP BY 1
 ORDER BY count DESC, failure_class
 LIMIT $2`;

const int = (v: Num): number => (v === null ? 0 : Math.round(Number(v)));
const intOrNull = (v: Num): number | null => (v === null ? null : Math.round(Number(v)));

function toGroup(r: GroupRow): AgentTaskMetricsGroup {
    const total = int(r.total), completed = int(r.completed), failed = int(r.failed), cancelled = int(r.cancelled);
    const finished = completed + failed + cancelled;
    const approvalRequests = int(r.approval_requests), questions = int(r.questions);
    const deviceWaits = int(r.device_waits), browserTakeovers = int(r.browser_takeovers);
    return {
        executor: r.is_total ? null : r.executor,
        ...(r.thinking_level !== undefined && r.thinking_level !== null ? { thinkingLevel: r.thinking_level } : {}),
        total, completed, failed, cancelled, inProgress: int(r.in_progress),
        successRate: finished > 0 ? completed / finished : null,
        durationP50Ms: intOrNull(r.duration_p50_ms),
        durationP95Ms: intOrNull(r.duration_p95_ms),
        tokenTasks: int(r.token_tasks),
        tokensAvg: intOrNull(r.tokens_avg),
        tokensSum: int(r.tokens_sum),
        cachedPromptTokensSum: int(r.cached_prompt_tokens_sum),
        approvalRequests, questions, deviceWaits, browserTakeovers,
        interventionsPerTask: total > 0 ? (approvalRequests + questions + deviceWaits + browserTakeovers) / total : null,
    };
}

const THINKING_LEVEL_ORDER = ['off', 'low', 'medium', 'high'] as const;
/** 수준별 행을 고정 순서로 — 작업이 없는 수준은 0건 묶음(화면 열이 흔들리지 않게). */
function byThinkingLevelOf(rows: GroupRow[]): AgentTaskMetricsGroup[] {
    return THINKING_LEVEL_ORDER.map((level) => {
        const r = rows.find((x) => x.thinking_level === level);
        return r ? toGroup(r) : { ...toGroup({ executor: null, is_total: false, total: '0', completed: '0', failed: '0', cancelled: '0', in_progress: '0',
            duration_p50_ms: null, duration_p95_ms: null, token_tasks: '0', tokens_avg: null, tokens_sum: null, cached_prompt_tokens_sum: null,
            approval_requests: null, questions: null, device_waits: null, browser_takeovers: null }), thinkingLevel: level };
    });
}

export interface AgentTaskOutcomeMetrics {
    overall: AgentTaskMetricsGroup;
    byExecutor: AgentTaskMetricsGroup[];
    byThinkingLevel: AgentTaskMetricsGroup[];
    topFailures: AgentTaskFailureCount[];
}

export class AgentTaskOutcomeMetricsRepository extends BaseRepository {
    async getMetrics(opts: { days: number; failureTopN: number }): Promise<AgentTaskOutcomeMetrics> {
        const questionTools = [...HITL_ALWAYS_WAIT_TOOLS];
        const [groups, failures, thinking] = await Promise.all([
            this.query<GroupRow>(GROUP_SQL, [opts.days, questionTools, AGENT_TASK_DEVICE_WAIT_REASON, AGENT_TASK_BROWSER_TAKEOVER_REASON]),
            this.query<{ failure_class: string; count: Num }>(FAILURE_SQL, [opts.days, opts.failureTopN]),
            this.query<GroupRow>(THINKING_SQL, [opts.days, questionTools, AGENT_TASK_DEVICE_WAIT_REASON, AGENT_TASK_BROWSER_TAKEOVER_REASON]),
        ]);
        const rows = groups.rows.map(toGroup);
        const overallRow = groups.rows.findIndex((r) => r.is_total);
        return {
            overall: rows[overallRow],
            byExecutor: rows.filter((_, i) => i !== overallRow),
            byThinkingLevel: byThinkingLevelOf(thinking.rows),
            topFailures: failures.rows.map((f) => ({ failureClass: f.failure_class, count: int(f.count) })),
        };
    }
}
