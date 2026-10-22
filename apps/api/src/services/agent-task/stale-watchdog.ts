/**
 * 에이전트 작업 watchdog(R8-b, R9-c) — 주기마다 진행이 멈춘 실행 중 작업, 대기열 적체, 모델 대기 장기화를 게이지와 알림으로 드러낸다.
 * 작업 상태는 바꾸지 않는다(알림·게이지·로그만) — 멈춘 작업을 끊거나 되살리는 판단은 사람·기존 복구 장치의 몫이다.
 * 단계마다 따로 잡는다 — 한 단계의 조회 실패가 다음 단계를 막지 않는다. 반복 알림은 AlertSystem 쿨다운이 거른다.
 *
 * @module services/agent-task/stale-watchdog
 */
import { getPool } from '../../data/models/unified-database';
import { AgentTaskProgressRepository } from '../../data/repositories/agent-task-progress-repository';
import { AgentTaskRepository } from '../../data/repositories/agent-task-repository';
import { AGENT_TASK_LIMITS } from '../../config/runtime-limits';
import { AGENT_TASK_MODEL_WAIT_REASON } from '../../config/agent-task-park-reasons';
import { getMetrics } from '../../monitoring/metrics';
import { sendAgentTaskAlert, ALERT_TEXT } from '../../monitoring/agent-task-alerts';
import { createLogger } from '../../utils/logger';
import { getAgentTaskQueue } from './task-queue';
import { isAgentTaskShutdown } from './shutdown-drain';
import { markLoopRun } from './background-liveness';

const logger = createLogger('AgentTaskWatchdog');

export interface WatchdogTickResult { stale: number; queueBacklog: boolean; modelWaitLong: number; skipped?: 'shutdown' | 'disabled' }

const errText = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** watchdog 한 번 — 절대 throw 하지 않는다. 대기·멈춤 시간은 DB·큐가 잰다 */
export async function runWatchdogTick(): Promise<WatchdogTickResult> {
    markLoopRun('watchdog'); // readiness 가 보는 생존 기록(R9-b) — 꺼짐·종료 검사보다 앞
    const out: WatchdogTickResult = { stale: 0, queueBacklog: false, modelWaitLong: 0 };
    if (!AGENT_TASK_LIMITS.WATCHDOG_ENABLED) return { ...out, skipped: 'disabled' };
    if (isAgentTaskShutdown()) return { ...out, skipped: 'shutdown' };
    const metrics = getMetrics();

    // 1. 진행이 멈춘 실행 중 작업 — 주차·승인 대기는 저장소 조회가 뺀다
    try {
        const rows = await new AgentTaskProgressRepository(getPool()).listStaleRunningTasks(AGENT_TASK_LIMITS.STALE_MS);
        out.stale = rows.length;
        metrics.setGauge('agent_task_stale_running', rows.length);
        if (rows.length > 0) {
            const data = { count: rows.length, taskIds: rows.slice(0, 5).map((r) => r.id), oldestStalledMs: Math.max(...rows.map((r) => r.stalled_ms)) };
            void sendAgentTaskAlert('agent_task_stale', ALERT_TEXT.agent_task_stale.title, ALERT_TEXT.agent_task_stale.message(data), data);
            logger.warn(`진행이 멈춘 실행 중 작업 ${rows.length}건: ${data.taskIds.join(', ')}`);
        }
    } catch (e) {
        logger.warn(`멈춘 작업 점검 실패(건너뜀): ${errText(e)}`);
    }

    // 2. 대기열 적체 — 대기 없으면 가장 오래 기다린 시간은 0(/metrics 와 같은 규칙)
    try {
        const q = getAgentTaskQueue().stats();
        const oldestWaitMs = q.wait.oldestPendingMs ?? 0;
        metrics.setGauge('agent_task_queue_pending', q.pending);
        metrics.setGauge('agent_task_queue_active', q.globalActive);
        metrics.setGauge('agent_task_queue_oldest_wait_ms', oldestWaitMs);
        out.queueBacklog = q.pending >= AGENT_TASK_LIMITS.QUEUE_BACKLOG_PENDING || oldestWaitMs >= AGENT_TASK_LIMITS.QUEUE_BACKLOG_WAIT_MS;
        if (out.queueBacklog) {
            const data = { pending: q.pending, active: q.globalActive, oldestWaitMs };
            void sendAgentTaskAlert('agent_task_queue_backlog', ALERT_TEXT.agent_task_queue_backlog.title, ALERT_TEXT.agent_task_queue_backlog.message(data), data);
        }
    } catch (e) {
        logger.warn(`대기열 점검 실패(건너뜀): ${errText(e)}`);
    }

    const taskRepo = new AgentTaskRepository(getPool());

    // 3. 모델 대기 장기화 — 게이지는 모델 대기 전체, 알림은 기준을 넘긴 것만
    try {
        const waiting = (await taskRepo.listParkedTasks(200)).filter((t) => t.reason === AGENT_TASK_MODEL_WAIT_REASON);
        const long = waiting.filter((t) => Number(t.waited_ms ?? 0) >= AGENT_TASK_LIMITS.MODEL_WAIT_ALERT_MS); // pg bigint 는 문자열로 온다
        out.modelWaitLong = long.length;
        metrics.setGauge('agent_task_model_wait_parked', waiting.length);
        if (long.length > 0) {
            const data = { count: long.length, taskIds: long.slice(0, 5).map((t) => t.id), thresholdMs: AGENT_TASK_LIMITS.MODEL_WAIT_ALERT_MS };
            void sendAgentTaskAlert('agent_task_model_wait_long', ALERT_TEXT.agent_task_model_wait_long.title, ALERT_TEXT.agent_task_model_wait_long.message(data), data);
        }
    } catch (e) {
        logger.warn(`모델 대기 점검 실패(건너뜀): ${errText(e)}`);
    }

    // 4. 활성 상태별 건수
    try {
        const counts = await taskRepo.countActiveAgentTasksByStatus();
        for (const [status, n] of Object.entries(counts)) metrics.setGauge('agent_task_status_count', n, { status });
    } catch (e) {
        logger.warn(`상태별 건수 점검 실패(건너뜀): ${errText(e)}`);
    }

    return out;
}
