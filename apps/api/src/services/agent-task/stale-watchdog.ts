/**
 * 에이전트 작업 watchdog(R8-b, R9-c) — 주기마다 진행이 멈춘 실행 중 작업, 대기열 적체, 모델 대기 장기화, 소유자 없이 오래 멈춘 pending(#1478)을 게이지와 알림으로 드러낸다.
 * 작업 상태는 바꾸지 않는다(알림·게이지·로그만) — 멈춘 작업을 끊거나 되살리는 판단은 사람·기존 복구 장치의 몫이다.
 * 단계마다 따로 잡는다 — 한 단계의 조회 실패가 다음 단계를 막지 않는다. 반복 알림은 AlertSystem 쿨다운이 거른다.
 * 실패한 단계는 오류 게이지만 올리고 그 단계의 값은 그대로 둔다(0 이나 정상으로 위장하지 않는다). 앞 tick 이 아직 돌면 건너뛴다.
 * 경고였던 단계가 성공 조회로 정상이 되면 해소 알림(info)을 전이마다 한 번 보낸다 — 조회 실패는 해소가 아니다(#1478).
 *
 * @module services/agent-task/stale-watchdog
 */
import { getPool } from '../../data/models/unified-database';
import { AgentTaskProgressRepository } from '../../data/repositories/agent-task-progress-repository';
import { AgentTaskRepository } from '../../data/repositories/agent-task-repository';
import { AGENT_TASK_LIMITS } from '../../config/runtime-limits';
import { AGENT_TASK_MODEL_WAIT_REASON } from '../../config/agent-task-park-reasons';
import { getMetrics } from '../../monitoring/metrics';
import { sendAgentTaskAlert, ALERT_TEXT, AGENT_TASK_RESOLVED_ALERT } from '../../monitoring/agent-task-alerts';
import { createLogger } from '../../utils/logger';
import { getAgentTaskQueue } from './task-queue';
import { isAgentTaskShutdown } from './shutdown-drain';
import { markLoopRun } from './background-liveness';

const logger = createLogger('AgentTaskWatchdog');

export interface WatchdogTickResult { stale: number; queueBacklog: boolean; modelWaitLong: number; stalePending: number; skipped?: 'shutdown' | 'disabled' | 'overlap' }

/** 단계 이름 — 오류·마지막 성공 게이지의 stage 라벨(고정 5개라 cardinality 가 늘지 않는다) */
type WatchdogStage = 'stale' | 'queue' | 'model_wait' | 'stale_pending' | 'status_count';

const errText = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** 알림에 싣는 작업 id 표본 수 */
const ALERT_SAMPLE_SIZE = 5;

type WatchdogWarning = keyof typeof AGENT_TASK_RESOLVED_ALERT;

/** 경고 중인 종류 — 성공 조회가 정상을 보면 해소를 한 번 보내고 지운다. 조회 실패는 건드리지 않는다. 프로세스 메모리에만 있다(시작은 정상) */
const warning: Record<WatchdogWarning, boolean> = { agent_task_stale: false, agent_task_queue_backlog: false, agent_task_model_wait_long: false, agent_task_stale_pending: false };

/** 성공 조회의 판정을 기억에 반영한다 — 경고 → 정상 전이일 때만 해소 알림 */
function settle(type: WatchdogWarning, unhealthy: boolean, data: Record<string, unknown>): void {
    if (unhealthy) { warning[type] = true; return; }
    if (!warning[type]) return;
    warning[type] = false;
    const resolved = AGENT_TASK_RESOLVED_ALERT[type];
    void sendAgentTaskAlert(resolved, ALERT_TEXT[resolved].title, ALERT_TEXT[resolved].message(data), data);
}

/** 앞 tick 이 아직 도는 중인가 — 겹친 tick 은 조회도 생존 기록도 하지 않는다(멈춘 tick 을 readiness 가 잡게) */
let ticking = false;

/** 한 단계 — 성공이면 오류 0·마지막 성공 시각, 실패면 오류 1 만 남기고 그 단계의 다른 게이지는 건드리지 않는다 */
async function runStage(metrics: ReturnType<typeof getMetrics>, stage: WatchdogStage, what: string, fn: () => Promise<void> | void): Promise<void> {
    try {
        await fn();
        metrics.setGauge('agent_task_watchdog_stage_error', 0, { stage });
        metrics.setGauge('agent_task_watchdog_stage_last_success_seconds', Math.floor(Date.now() / 1000), { stage });
    } catch (e) {
        metrics.setGauge('agent_task_watchdog_stage_error', 1, { stage });
        logger.warn(`${what} 점검 실패(건너뜀): ${errText(e)}`);
    }
}

/** watchdog 한 번 — 절대 throw 하지 않는다. 대기·멈춤 시간은 DB·큐가 잰다 */
export async function runWatchdogTick(): Promise<WatchdogTickResult> {
    const out: WatchdogTickResult = { stale: 0, queueBacklog: false, modelWaitLong: 0, stalePending: 0 };
    if (ticking) return { ...out, skipped: 'overlap' };
    ticking = true;
    try {
        return await runAcceptedTick(out);
    } catch (e) {
        logger.warn(`watchdog tick 실패(건너뜀): ${errText(e)}`);
        return out;
    } finally {
        ticking = false;
    }
}

async function runAcceptedTick(out: WatchdogTickResult): Promise<WatchdogTickResult> {
    markLoopRun('watchdog'); // readiness 가 보는 생존 기록(R9-b) — 꺼짐·종료 검사보다 앞
    if (!AGENT_TASK_LIMITS.WATCHDOG_ENABLED) return { ...out, skipped: 'disabled' };
    if (isAgentTaskShutdown()) return { ...out, skipped: 'shutdown' };
    const metrics = getMetrics();

    // 1. 진행이 멈춘 실행 중 작업 — 주차·승인 대기는 저장소 조회가 뺀다
    await runStage(metrics, 'stale', '멈춘 작업', async () => {
        const rows = await new AgentTaskProgressRepository(getPool()).listStaleRunningTasks(AGENT_TASK_LIMITS.STALE_MS);
        out.stale = rows.length;
        metrics.setGauge('agent_task_stale_running', rows.length);
        if (rows.length > 0) {
            const data = { count: rows.length, taskIds: rows.slice(0, ALERT_SAMPLE_SIZE).map((r) => r.id), oldestStalledMs: Math.max(...rows.map((r) => r.stalled_ms)) };
            void sendAgentTaskAlert('agent_task_stale', ALERT_TEXT.agent_task_stale.title, ALERT_TEXT.agent_task_stale.message(data), data);
            logger.warn(`진행이 멈춘 실행 중 작업 ${rows.length}건: ${data.taskIds.join(', ')}`);
        }
        settle('agent_task_stale', rows.length > 0, { count: 0 });
    });

    // 2. 대기열 적체 — 대기 없으면 가장 오래 기다린 시간은 0(/metrics 와 같은 규칙)
    await runStage(metrics, 'queue', '대기열', () => {
        const q = getAgentTaskQueue().stats();
        const oldestWaitMs = q.wait.oldestPendingMs ?? 0;
        metrics.setGauge('agent_task_queue_pending', q.pending);
        metrics.setGauge('agent_task_queue_active', q.globalActive);
        metrics.setGauge('agent_task_queue_oldest_wait_ms', oldestWaitMs);
        out.queueBacklog = q.pending >= AGENT_TASK_LIMITS.QUEUE_BACKLOG_PENDING || oldestWaitMs >= AGENT_TASK_LIMITS.QUEUE_BACKLOG_WAIT_MS;
        const data = { pending: q.pending, active: q.globalActive, oldestWaitMs };
        if (out.queueBacklog) {
            void sendAgentTaskAlert('agent_task_queue_backlog', ALERT_TEXT.agent_task_queue_backlog.title, ALERT_TEXT.agent_task_queue_backlog.message(data), data);
        }
        settle('agent_task_queue_backlog', out.queueBacklog, data);
    });

    // 3. 모델 대기 장기화 — 게이지는 모델 대기 전체, 알림은 기준을 넘긴 것만. 건수는 목록 상한 없이 DB 가 센다(#1478)
    await runStage(metrics, 'model_wait', '모델 대기', async () => {
        const thresholdMs = AGENT_TASK_LIMITS.MODEL_WAIT_ALERT_MS;
        const s = await new AgentTaskProgressRepository(getPool()).summarizeParkedByReason(AGENT_TASK_MODEL_WAIT_REASON, thresholdMs, ALERT_SAMPLE_SIZE);
        out.modelWaitLong = s.longCount;
        metrics.setGauge('agent_task_model_wait_parked', s.count);
        if (s.longCount > 0) {
            // 표본은 오래 기다린 순이라 기준을 넘긴 것이 앞에 모인다
            const data = { count: s.longCount, taskIds: s.oldest.filter((t) => t.waited_ms >= thresholdMs).map((t) => t.id), thresholdMs };
            void sendAgentTaskAlert('agent_task_model_wait_long', ALERT_TEXT.agent_task_model_wait_long.title, ALERT_TEXT.agent_task_model_wait_long.message(data), data);
        }
        settle('agent_task_model_wait_long', s.longCount > 0, { parked: s.count, thresholdMs });
    });

    // 4. 오래된 pending(#1478) — 소유권이 없거나 지난 대기 작업 중 최근 활동이 STALE_MS 보다 오래된 것. 살아 있는 소유권 경계는 lease 저장소 것 그대로, 건수는 DB 가 센다
    await runStage(metrics, 'stale_pending', '오래된 대기', async () => {
        const s = await new AgentTaskProgressRepository(getPool()).summarizeStalePendingTasks(AGENT_TASK_LIMITS.STALE_MS, ALERT_SAMPLE_SIZE);
        out.stalePending = s.count;
        metrics.setGauge('agent_task_stale_pending', s.count);
        if (s.count > 0) {
            const data = { count: s.count, taskIds: s.taskIds, oldestStalledMs: s.oldestStalledMs };
            void sendAgentTaskAlert('agent_task_stale_pending', ALERT_TEXT.agent_task_stale_pending.title, ALERT_TEXT.agent_task_stale_pending.message(data), data);
            logger.warn(`소유자 없이 오래 멈춘 대기 작업 ${s.count}건: ${s.taskIds.join(', ')}`);
        }
        settle('agent_task_stale_pending', s.count > 0, { count: 0 });
    });

    // 5. 활성 상태별 건수 — 저장소가 네 상태를 모두 채워 돌려줘 사라진 상태도 0 으로 갱신된다
    await runStage(metrics, 'status_count', '상태별 건수', async () => {
        const counts = await new AgentTaskRepository(getPool()).countActiveAgentTasksByStatus();
        for (const [status, n] of Object.entries(counts)) metrics.setGauge('agent_task_status_count', n, { status });
    });

    return out;
}
