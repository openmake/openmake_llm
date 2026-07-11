/**
 * Agent Task 스케줄 러너 (Phase 3-A) — due 스케줄을 task 로 실행.
 *
 * 스케줄러 tick 이 next_run_at <= now 인 enabled 스케줄을 찾아 agent_task 를 생성하고
 * 큐(3-B)에 제출한 뒤 next_run_at 을 재계산한다. 생성/제출 실패는 연속실패로 집계해
 * 임계 초과 시 스케줄을 자동 비활성(폭주 차단). 단일 프로세스 전제(API instances:1).
 *
 * @module services/agent-task/schedule-runner
 */
import { v4 as uuidv4 } from 'uuid';
import { getPool, getUnifiedDatabase } from '../../data/models/unified-database';
import { AgentTaskScheduleRepository, type AgentTaskSchedule } from '../../data/repositories/agent-task-schedule-repository';
import { AGENT_TASK_LIMITS } from '../../config/runtime-limits';
import { createLogger } from '../../utils/logger';
import { AgentTaskService } from '../AgentTaskService';
import { getPushService } from '../PushService';
import { dispatchAgentTask } from './task-queue';
import { computeNextRun } from './schedule-cron';
import type { AgentTaskUserRole } from './types';

const logger = createLogger('AgentTaskSchedule');

let ticking = false;

/** 스케줄 소유자 역할 조회(부팅/스케줄 컨텍스트엔 req.user 없음). 실패 시 'user'. */
async function resolveRole(userId?: string): Promise<AgentTaskUserRole> {
    if (!userId) return 'user';
    try {
        const u = await getUnifiedDatabase().getUserById(String(userId));
        return u?.role === 'admin' || u?.role === 'guest' ? u.role : 'user';
    } catch {
        return 'user';
    }
}

/** 단일 due 스케줄을 실행 — task 생성 + 큐 제출 + next_run_at 갱신. */
async function fireSchedule(repo: AgentTaskScheduleRepository, s: AgentTaskSchedule, nowMs: number): Promise<void> {
    const timing = { cron: s.cron, intervalSeconds: s.interval_seconds };
    const nextRunAtMs = computeNextRun(timing, nowMs);
    try {
        const db = getUnifiedDatabase();
        const taskId = uuidv4();
        await db.createAgentTask({ id: taskId, userId: s.user_id, goal: s.goal, maxTurns: s.max_turns });
        const role = await resolveRole(s.user_id);
        const service = new AgentTaskService();
        await dispatchAgentTask({
            taskId,
            userId: String(s.user_id),
            run: () => service.execute({
                taskId, goal: s.goal, userId: String(s.user_id), userRole: role, maxTurns: s.max_turns,
            }),
        });
        await repo.markRun(s.id, nextRunAtMs, taskId);
        // 발화 이력(6-2) — 실패해도 발화 자체를 막지 않음.
        await repo.recordRun({ scheduleId: s.id, userId: s.user_id, taskId, outcome: 'fired' }).catch(() => { /* noop */ });
        logger.info(`[Schedule] 실행: ${s.id} → task ${taskId} (next=${nextRunAtMs ? new Date(nextRunAtMs).toISOString() : '비활성'})`);
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        // 실패 시 next_run_at 을 앞으로 밀어 무한 재시도 방지 + 연속실패 집계.
        await repo.markFailure(s.id, nextRunAtMs, AGENT_TASK_LIMITS.SCHEDULE_DISABLE_AFTER_FAILURES)
            .catch(() => { /* noop */ });
        await repo.recordRun({ scheduleId: s.id, userId: s.user_id, outcome: 'error', error: msg.slice(0, 500) }).catch(() => { /* noop */ });
        // 실패 알림(6-2) — 스케줄은 사용자가 안 보는 새 도는 백그라운드라 push 로 인지시킨다.
        // 연속실패 임계 도달(자동 비활성) 여부를 함께 알린다. fire-and-forget.
        const failures = (s.consecutive_failures ?? 0) + 1;
        const disabled = failures >= AGENT_TASK_LIMITS.SCHEDULE_DISABLE_AFTER_FAILURES;
        void getPushService().sendPush(String(s.user_id), {
            title: 'OpenMake 예약 작업 실패',
            body: `예약 실행이 실패했습니다(연속 ${failures}회${disabled ? ' — 예약 자동 비활성됨' : ''}): ${s.goal.slice(0, 50)}`,
            url: '/agent-tasks',
        }).catch(() => { /* noop */ });
        logger.warn(`[Schedule] 실행 실패: ${s.id} — ${msg}`);
    }
}

/** 한 번의 tick — due 스케줄 전부 처리. 재진입 방지(느린 tick 이 겹치지 않게). */
export async function runScheduleTick(nowMs = Date.now()): Promise<number> {
    if (ticking) return 0;
    ticking = true;
    try {
        const repo = new AgentTaskScheduleRepository(getPool());
        const due = await repo.getDue(nowMs);
        for (const s of due) {
            await fireSchedule(repo, s, nowMs);
        }
        return due.length;
    } catch (e) {
        logger.warn(`[Schedule] tick 실패: ${e instanceof Error ? e.message : e}`);
        return 0;
    } finally {
        ticking = false;
    }
}

/** 스케줄러 시작 — 플래그 ON 일 때만. schedulers/index.ts 가 호출. */
export function startAgentTaskScheduleScheduler(): NodeJS.Timeout | null {
    if (!AGENT_TASK_LIMITS.SCHEDULES_ENABLED) return null;
    const timer = setInterval(() => { void runScheduleTick(); }, AGENT_TASK_LIMITS.SCHEDULE_TICK_MS);
    timer.unref();
    logger.info(`[Schedule] 스케줄러 시작 (tick ${AGENT_TASK_LIMITS.SCHEDULE_TICK_MS}ms)`);
    return timer;
}
