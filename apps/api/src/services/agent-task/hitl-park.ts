/**
 * 질문 응답 대기 주차·재개 (F16.7, 2026-09-17).
 *
 * `AGENT_TASK_HITL_PARK_ON_TIMEOUT` 이면 질문형 승인(ask_human·mcp_elicit)의 만료가 거절이 아니라 **주차**가 된다:
 * 승인 행은 pending 으로 연장되고(approval-gate), 작업은 체크포인트 후 paused + 주차 표식(turn-executor)으로 실행 슬롯을 반납한다.
 *
 * - `resumeParkedTask`: 승인함에서 답·승인·거절이 오면(approvals 라우트) 원자적 claim 후 체크포인트에서 재개한다.
 *   재개된 작업은 turn-reentry 가 같은 질문 호출을 다시 실행하고, 승인 레지스트리가 저장소의 결정을 이어받는다.
 * - `sweepParkedTasks`(주기): 결정이 있는데 재개되지 않은 작업(로컬 디바이스 미연결·재개 직전 재시작)은 다시 재개,
 *   대기 상한(`AGENT_TASK_HITL_PARK_MAX_MS`)이 지난 작업은 failed(hitl_park_expired), 아직 기다리는 작업은
 *   샌드박스 workspace 의 mtime 을 갱신해 stale workspace 스윕(TTL 72h)에 지워지지 않게 한다.
 *
 * 부팅 시 좀비 마킹(schema-initializer)·부팅 복구는 주차 작업을 건드리지 않는다(parkedTaskCondition).
 *
 * @module services/agent-task/hitl-park
 */
import { utimes } from 'fs/promises';
import { getUnifiedDatabase, getPool } from '../../data/models/unified-database';
import { AgentTaskRepository } from '../../data/repositories/agent-task-repository';
import { AgentTaskApprovalRepository } from '../../data/repositories/agent-task-approval-repository';
import { AgentTaskService, type AgentTaskInputFile } from '../AgentTaskService';
import { dispatchAgentTask } from './task-queue';
import { resolveUserRole } from './boot-recovery';
import { LOCAL_BRIDGE } from '../../config/local-bridge';
import { getLocalBridgeRegistry } from '../local-bridge/registry';
import { createLogger } from '../../utils/logger';
import type { ChatMessage } from '../../llm/types';

const logger = createLogger('AgentTaskHitlPark');

/** 대기 상한이 지나 주차가 끝난 작업의 error 코드 — config/agent-task-failure-class 에서 timeout 으로 분류 */
export const AGENT_TASK_PARK_EXPIRED_ERROR = 'hitl_park_expired';

/**
 * 주차 중인 작업을 재개한다. 주차가 아니거나(살아 있는 대기·이미 재개됨) 체크포인트가 없거나
 * 로컬 디바이스가 연결되지 않았으면 false(주차 유지 — 스윕이 다시 시도). 예외는 호출부로.
 */
export async function resumeParkedTask(taskId: string): Promise<boolean> {
    const db = getUnifiedDatabase();
    const task = await db.getAgentTask(taskId);
    if (!task || task.status !== 'paused') return false;
    const cp = task.checkpoint as { conversation?: unknown[]; completedTurn?: number } | null | undefined;
    if (!cp || !Array.isArray(cp.conversation) || cp.conversation.length === 0) return false;
    if (task.executor === 'local' && (!LOCAL_BRIDGE.ENABLED || !getLocalBridgeRegistry().getDevice(String(task.user_id), task.device_id ?? undefined))) {
        logger.info(`[${taskId}] 주차 재개 보류 — 로컬 디바이스 미연결(스윕이 다시 시도)`);
        return false;
    }
    if (!(await new AgentTaskRepository(getPool()).claimParkedTask(taskId))) return false;

    const role = await resolveUserRole(db, task.user_id);
    const steps = await db.getAgentTaskSteps(taskId);
    const service = new AgentTaskService();
    const outcome = await dispatchAgentTask({
        taskId,
        userId: String(task.user_id),
        priority: task.priority,
        run: () => service.execute({
            taskId,
            goal: task.goal,
            userId: String(task.user_id),
            userRole: role,
            maxTurns: task.max_turns,
            files: Array.isArray(task.input_files) ? task.input_files as AgentTaskInputFile[] : undefined,
            images: Array.isArray(task.input_images) ? task.input_images as string[] : undefined,
            executor: task.executor === 'local' ? 'local' : undefined,
            deviceId: task.device_id ?? undefined,
            folderRel: task.folder_rel ?? undefined,
            resume: {
                conversation: cp.conversation as ChatMessage[],
                fromTurn: (cp.completedTurn ?? 0) + 1,
                fromStep: steps.length,
                plan: task.plan,
            },
        }),
    });
    logger.info(`[${taskId}] 주차 작업 재개 ${outcome === 'queued' ? '대기열 등록' : '시작'} (turn ${(cp.completedTurn ?? 0) + 1})`);
    return true;
}

/** 주기 스윕 — 결정 도착분 재개 · 상한 초과분 실패 · 대기분 workspace 유지. 절대 throw 하지 않는다. */
export async function sweepParkedTasks(): Promise<{ resumed: number; expired: number; touched: number }> {
    const out = { resumed: 0, expired: 0, touched: 0 };
    let rows;
    try {
        rows = await new AgentTaskRepository(getPool()).listParkedTasks();
    } catch (e) {
        logger.warn(`주차 작업 조회 실패(건너뜀): ${e instanceof Error ? e.message : e}`);
        return out;
    }
    const now = new Date();
    for (const t of rows) {
        try {
            if (t.has_decision) {
                if (await resumeParkedTask(t.id)) out.resumed++;
            } else if (!t.has_live_pending) {
                await new AgentTaskApprovalRepository(getPool()).expirePendingForTask(t.id, 'expired');
                await getUnifiedDatabase().updateAgentTask(t.id, { status: 'failed', error: AGENT_TASK_PARK_EXPIRED_ERROR });
                out.expired++;
            } else if (t.workspace_path) {
                await utimes(t.workspace_path, now, now);
                out.touched++;
            }
        } catch (e) {
            logger.warn(`[${t.id}] 주차 스윕 처리 실패(다음 주기에 재시도): ${e instanceof Error ? e.message : e}`);
        }
    }
    if (out.resumed || out.expired) logger.info(`주차 스윕 — 재개 ${out.resumed} · 만료 ${out.expired} · 대기 ${out.touched}`);
    return out;
}
