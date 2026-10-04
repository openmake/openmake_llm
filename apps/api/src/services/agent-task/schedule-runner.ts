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
import { getApprovalRegistry } from '../task-sandbox/approval-gate';
import { publishScheduleOutput } from './schedule-publish';
import { computeNextRun } from './schedule-cron';
import { scheduleFireKey, isPreviousRunActive, isRetryFire } from './schedule-fire';
import { applyScheduleOutcome } from './schedule-outcome';
import { getScheduleSilentNote } from '../../prompts/agent-task-schedule';
import { AGENT_TASK_SCHEDULE } from '../../config/agent-task-schedule';
import type { AgentTaskUserRole } from './types';
import { isAdminRole } from '../../data/user-manager';

const logger = createLogger('AgentTaskSchedule');

let ticking = false;

/** 스케줄 소유자 역할 조회(부팅/스케줄 컨텍스트엔 req.user 없음). 실패 시 'user'. */
async function resolveRole(userId?: string): Promise<AgentTaskUserRole> {
    if (!userId) return 'user';
    try {
        const u = await getUnifiedDatabase().getUserById(String(userId));
        return isAdminRole(u?.role) || u?.role === 'guest' ? u.role : 'user';
    } catch {
        return 'user';
    }
}

/**
 * 완료된 예약 task 의 산출물을 게시하고, 소유자에게 링크를 push 한다.
 * 게시 대상이 아니거나(publish_slug 없음) 실패해도 task 결과에는 영향 없음.
 */
async function publishCompleted(taskId: string, s: AgentTaskSchedule): Promise<void> {
    if (!s.publish_slug) return;
    try {
        const task = await getUnifiedDatabase().getAgentTask(taskId);
        if (task?.status !== 'completed') return;
        const url = await publishScheduleOutput(s.publish_slug, (task as { workspace_path?: string }).workspace_path);
        if (!url) return;
        // 완료 push 는 AgentTaskService 가 이미 보냈지만 목적지가 /agent-tasks 라 무인 실행에는
        // 쓸모가 적다. 게시된 리포트로 바로 열리는 링크를 한 번 더 보낸다.
        void getPushService().sendPush(String(s.user_id), {
            title: 'OpenMake 예약 리포트',
            body: `오늘의 리포트가 준비되었습니다: ${s.goal.slice(0, 40)}`,
            url,
        }).catch(() => { /* noop */ });
    } catch (e) {
        logger.warn(`[Schedule] 산출물 게시 실패: ${taskId} — ${e instanceof Error ? e.message : e}`);
    }
}

/** 단일 due 스케줄을 실행 — task 생성 + 큐 제출 + next_run_at 갱신. */
async function fireSchedule(repo: AgentTaskScheduleRepository, s: AgentTaskSchedule, nowMs: number): Promise<void> {
    const timing = { cron: s.cron, intervalSeconds: s.interval_seconds };
    // 모델 미도달 재실행 발화(schedule-outcome)는 정규 발화 시각을 건드리지 않는다.
    const retry = isRetryFire(s, nowMs);
    const nextRunAtMs = retry ? new Date(s.next_run_at).getTime() : computeNextRun(timing, nowMs);
    // 연속 실패를 실행 결과로 세면(schedule-outcome) 제출 성공만으로는 카운터를 풀지 않는다.
    const resetOnSubmit = !AGENT_TASK_SCHEDULE.RUN_OUTCOME_ENABLED;
    try {
        const db = getUnifiedDatabase();
        // 이전 실행이 아직 돌고 있으면 이번 발화는 건너뛴다 — 같은 리포트의 중복 생성·게시 파일 덮어쓰기 방지(schedule-fire).
        const last = await repo.getLastTaskState(s.last_task_id).catch(() => null);
        if (isPreviousRunActive(last, nowMs, AGENT_TASK_LIMITS.SCHEDULE_OVERLAP_STALE_MS)) {
            await repo.markSkipped(s.id, nextRunAtMs);
            await repo.recordRun({ scheduleId: s.id, userId: s.user_id, taskId: s.last_task_id ?? undefined, outcome: 'skipped', error: '이전 실행이 아직 진행 중' }).catch(() => { /* noop */ });
            logger.info(`[Schedule] 건너뜀: ${s.id} — 이전 실행(${s.last_task_id}) 진행 중`);
            return;
        }
        const taskId = uuidv4();
        // 발화 멱등 키 — 작업을 만든 뒤 markRun 전에 죽었다면, 재시작 뒤 같은 발화는 작업을 다시 만들지 않는다.
        const fireKey = retry ? `${scheduleFireKey(s.id, s.retry_at!)}:retry` : scheduleFireKey(s.id, s.next_run_at);
        const created = await db.createAgentTask({ id: taskId, userId: s.user_id, goal: s.goal, maxTurns: s.max_turns, idempotencyKey: fireKey });
        if (!created) {
            const existing = await db.findAgentTaskByCreateKey(String(s.user_id), fireKey);
            await repo.markRun(s.id, nextRunAtMs, existing?.id ?? taskId, resetOnSubmit);
            logger.warn(`[Schedule] 같은 발화의 작업이 이미 있어 다시 만들지 않음: ${s.id} → ${existing?.id ?? '(조회 실패)'}`);
            return;
        }
        const role = await resolveRole(s.user_id);
        const service = new AgentTaskService();
        // "보고할 것 없음" 선언(기본 켜짐) — 목표 뒤에 표식 안내를 붙인다. 결과 반영이 꺼져 있으면 표식을 읽을 곳이 없어 붙이지 않는다.
        const runGoal = AGENT_TASK_SCHEDULE.RUN_OUTCOME_ENABLED && AGENT_TASK_SCHEDULE.SILENT_ENABLED ? s.goal + getScheduleSilentNote() : s.goal;
        await dispatchAgentTask({
            taskId,
            userId: String(s.user_id),
            // 무인 예약은 사람이 기다리는 실행보다 뒤로(131)
            priority: AGENT_TASK_LIMITS.QUEUE_PRIORITY_SCHEDULED,
            run: async () => {
                // 무인 표시 — 정책을 올린 예약에서 승인이 필요한 호출을 30분 기다리지 않고 설정된 결론으로 끝낸다(config/agent-task-approval).
                getApprovalRegistry().setUnattended(taskId, true);
                await service.execute({
                    taskId, goal: runGoal, userId: String(s.user_id), userRole: role, maxTurns: s.max_turns,
                    // 예약 task 는 무인 실행 — 사람이 승인할 수 없으므로 승인정책을 분리(기본 none).
                    // 전역 approvalPolicy='all' 이면 첫 도구서 pause 되어 예약이 영영 멈추는 것을 방지.
                    approvalPolicy: AGENT_TASK_LIMITS.SCHEDULE_APPROVAL_POLICY,
                    // 무거운 리포트 생성은 대화형 10분을 넘길 수 있어 예약 전용 총 예산(기본 20분) 부여.
                    totalTimeoutMs: AGENT_TASK_LIMITS.SCHEDULE_TOTAL_TIMEOUT_MS,
                    // 종료 결과를 예약에 반영 — 같은 실패는 한 번만 알리고 연속 실패면 예약을 끈다.
                    ...(AGENT_TASK_SCHEDULE.RUN_OUTCOME_ENABLED ? { onTerminal: (t) => applyScheduleOutcome(repo, s.id, t) } : {}),
                });
                // 산출물 게시 — 무인 실행은 채팅 세션도 아티팩트도 없어 이 경로가 유일한 도달 수단이다.
                // 게시 실패가 task 성공을 뒤집지 않게 격리(산출물은 workspace 에 그대로 남는다).
                await publishCompleted(taskId, s);
            },
        });
        await repo.markRun(s.id, nextRunAtMs, taskId, resetOnSubmit);
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
