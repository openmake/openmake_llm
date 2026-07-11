/**
 * Agent Task 부팅 자동 복구 (Phase 1 / 1-A) — durability.
 *
 * 프로세스 재시작 시 AgentTaskService 의 in-process 루프가 소멸한다. schema-initializer 가
 * 부팅 시 running/paused 를 failed('server restarted') 로 마킹해 좀비는 막지만(수동 resume 가능),
 * 사용자가 개입하기 전까지 작업은 멈춘 채다. 이 모듈은 부팅 직후 1회 호출되어 그 중
 * checkpoint 가 유효한 task 를 **자동 resume** 한다:
 *   - 복구 대상: ①잔존 running/paused(마킹 실패 대비) ②restart 마킹 + 최근 window 내
 *     (과거 재시작이 남긴 오래된 failed 는 수동 resume 대상으로 남긴다).
 *   - checkpoint 유효 → 원자적 claim(pending 전이 + error/completed_at 정리) 후 자동 resume(detached).
 *   - checkpoint 없음 → 잔존 running/paused 만 failed(interrupted) 로 정리,
 *     restart 마킹은 이미 failed 이므로 그대로 둔다(기존 UX 불변).
 *
 * ⚠️ 호출 순서: reapOrphanTaskSandboxes()(고아 컨테이너 무조건 제거) **이후**에 호출할 것 —
 *    먼저 실행하면 resume 이 만든 fresh 컨테이너를 reap 이 곧바로 죽인다.
 *
 * @module services/agent-task/boot-recovery
 */
import { getUnifiedDatabase, getPool } from '../../data/models/unified-database';
import { AgentTaskRepository } from '../../data/repositories/agent-task-repository';
import { AGENT_TASK_LIMITS } from '../../config/runtime-limits';
import { createLogger } from '../../utils/logger';
import { AgentTaskService, type AgentTaskInputFile } from '../AgentTaskService';
import { dispatchAgentTask } from './task-queue';
import type { ChatMessage } from '../../llm/types';
import type { AgentTaskUserRole } from './types';

const logger = createLogger('AgentTaskBootRecovery');

/**
 * 부팅 시 중단된 task 복구. 실패해도 서버 기동을 막지 않도록 절대 throw 하지 않는다.
 * @returns { resumed, failed } 처리 건수
 */
export async function recoverInterruptedAgentTasks(): Promise<{ resumed: number; failed: number }> {
    if (!AGENT_TASK_LIMITS.BOOT_RECOVERY_ENABLED) return { resumed: 0, failed: 0 };
    const db = getUnifiedDatabase();
    const taskRepo = new AgentTaskRepository(getPool());

    let interrupted;
    try {
        interrupted = await taskRepo.getInterruptedAgentTasks(AGENT_TASK_LIMITS.BOOT_RECOVERY_WINDOW_MS);
    } catch (e) {
        logger.warn(`[BootRecovery] 중단 task 조회 실패 — 건너뜀: ${e instanceof Error ? e.message : e}`);
        return { resumed: 0, failed: 0 };
    }
    if (interrupted.length === 0) return { resumed: 0, failed: 0 };
    logger.info(`[BootRecovery] 중단된 task ${interrupted.length}건 발견 — 복구 시작`);

    let resumed = 0;
    let failed = 0;
    for (const task of interrupted) {
        try {
            const cp = task.checkpoint as { conversation?: unknown[]; completedTurn?: number } | null | undefined;
            const hasCheckpoint = !!cp && Array.isArray(cp.conversation) && cp.conversation.length > 0;

            if (!hasCheckpoint) {
                // 재개 지점이 없음. restart 마킹(failed)은 이미 정리된 상태이므로 건드리지 않고,
                // 잔존 running/paused 만 실패(interrupted)로 정리(완료 오표시·영구 polling 방지).
                if (task.status === 'running' || task.status === 'paused') {
                    await db.updateAgentTask(task.id, { status: 'failed', error: 'interrupted', checkpoint: null });
                    failed++;
                    logger.info(`[BootRecovery] checkpoint 없음 → failed(interrupted): ${task.id}`);
                }
                continue;
            }

            // 원자적 소유권 획득 — 실패(rowCount=0)면 다른 프로세스가 이미 복구 중이므로 건너뜀.
            const claimed = await taskRepo.claimAgentTaskForRecovery(task.id);
            if (!claimed) continue;

            const role = await resolveUserRole(db, task.user_id);
            const steps = await db.getAgentTaskSteps(task.id);

            // detached 재개 — /resume 라우트와 동일 계약. 큐(3-B) 활성 시 상한 초과분은 'queued' 로 대기.
            const service = new AgentTaskService();
            await dispatchAgentTask({
                taskId: task.id,
                userId: String(task.user_id),
                run: () => service.execute({
                    taskId: task.id,
                    goal: task.goal,
                    userId: String(task.user_id),
                    userRole: role,
                    maxTurns: task.max_turns,
                    files: Array.isArray(task.input_files) ? task.input_files as AgentTaskInputFile[] : undefined,
                    images: Array.isArray(task.input_images) ? task.input_images as string[] : undefined,
                    resume: {
                        conversation: cp!.conversation as ChatMessage[],
                        fromTurn: (cp!.completedTurn ?? 0) + 1,
                        fromStep: steps.length,
                    },
                }),
            });
            resumed++;
            logger.info(`[BootRecovery] 자동 재개: ${task.id} (turn ${(cp!.completedTurn ?? 0) + 1})`);
        } catch (e) {
            logger.warn(`[BootRecovery] task 복구 실패(건너뜀): ${task.id} — ${e instanceof Error ? e.message : e}`);
        }
    }
    logger.info(`[BootRecovery] 복구 완료 — 재개 ${resumed}건, 실패정리 ${failed}건`);
    return { resumed, failed };
}

/** task 소유자의 역할을 조회 — 부팅 컨텍스트엔 req.user 가 없어 users 테이블에서 직접 조회. */
async function resolveUserRole(
    db: ReturnType<typeof getUnifiedDatabase>,
    userId: string | undefined,
): Promise<AgentTaskUserRole> {
    if (!userId) return 'user';
    try {
        const u = await db.getUserById(String(userId));
        const r = u?.role;
        return r === 'admin' || r === 'guest' ? r : 'user';
    } catch {
        return 'user';
    }
}
