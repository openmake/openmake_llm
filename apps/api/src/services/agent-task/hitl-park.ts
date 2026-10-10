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
 * - `expireParkedTasks`(더 짧은 주기): 상한 초과분만 실패로 바꾼다 — 본 스윕 주기(기본 10분)만큼 늦게 실패로 바뀌지 않게.
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
import { dispatchAgentTask, getAgentTaskQueue } from './task-queue';
import { resolveUserRole } from './boot-recovery';
import { LOCAL_BRIDGE } from '../../config/local-bridge';
import { getLocalBridgeRegistry } from '../local-bridge/registry';
import { createLogger } from '../../utils/logger';
import { AGENT_TASK_DEVICE_WAIT_REASON, AGENT_TASK_BROWSER_TAKEOVER_REASON } from '../../config/agent-task-park-reasons';
import { AGENT_TASK_BROWSER_TAKEOVER_EXPIRED_ERROR, browserTakeoverAction } from './browser-takeover';
import { AGENT_TASK_DEVICE_WAIT_EXPIRED_ERROR, deviceWaitAction } from './device-wait';
import type { ChatMessage } from '../../llm/types';

const logger = createLogger('AgentTaskHitlPark');

/** 대기 상한이 지나 주차가 끝난 작업의 error 코드 — config/agent-task-failure-class 에서 timeout 으로 분류 */
export const AGENT_TASK_PARK_EXPIRED_ERROR = 'hitl_park_expired';

/**
 * 주차 중인 작업을 재개한다. 주차가 아니거나(살아 있는 대기·이미 재개됨) 체크포인트가 없거나
 * 로컬 디바이스가 연결되지 않았거나 직전 실행이 아직 큐 자리를 쥐고 있으면 false(주차 유지 — 스윕이 다시 시도, 자리 보류분은 반납 직후 한 번 더). 예외는 호출부로.
 */
export async function resumeParkedTask(taskId: string): Promise<boolean> {
    const db = getUnifiedDatabase();
    const task = await db.getAgentTask(taskId);
    if (!task || task.status !== 'paused') return false;
    const cp = task.checkpoint as { conversation?: unknown[]; completedTurn?: number } | null | undefined;
    const hasCheckpoint = !!cp && Array.isArray(cp.conversation) && cp.conversation.length > 0;
    // 체크포인트 없는 재개는 기기 대기만 허용 — 시작 시점에 기기가 없어 아무 턴도 돌지 않은 작업이라 처음부터 다시 시작한다.
    if (!hasCheckpoint && (task.executor !== 'local' || !LOCAL_BRIDGE.DEVICE_WAIT_ENABLED)) return false;
    if (task.executor === 'local' && (!LOCAL_BRIDGE.ENABLED || !getLocalBridgeRegistry().getDevice(String(task.user_id), task.device_id ?? undefined))) {
        logger.info(`[${taskId}] 주차 재개 보류 — 로컬 디바이스 미연결(스윕이 다시 시도)`);
        return false;
    }
    // 주차 표식은 실행이 큐 자리를 반납하기 전(종료 정리 중)에 남는다 — 그 창에 claim 하면 디스패치가 'duplicate' 로 버려지고
    // 실행·대기 항목 없는 pending 행이 남는다(스윕·부팅 복구 대상도 아니다). claim 전에 막아 주차를 유지한다.
    // 자리가 반납되면 큐가 이 재개를 한 번 다시 시도한다(위 검사를 처음부터 다시 거친다) — 다음 스윕까지 기다리지 않게.
    if (getAgentTaskQueue().has(taskId)) {
        getAgentTaskQueue().retryAfterRelease(taskId, () => resumeParkedTask(taskId));
        logger.info(`[${taskId}] 주차 재개 보류 — 직전 실행의 종료 정리가 아직 안 끝남(자리 반납 뒤 다시 시도)`);
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
            ...(hasCheckpoint ? {
                resume: {
                    conversation: cp!.conversation as ChatMessage[],
                    fromTurn: (cp!.completedTurn ?? 0) + 1,
                    fromStep: steps.length,
                    plan: task.plan,
                },
            } : {}),
        }),
    });
    logger.info(`[${taskId}] 주차 작업 재개 ${outcome === 'queued' ? '대기열 등록' : outcome === 'duplicate' ? '생략 — 다른 경로가 먼저 제출' : '시작'} (${hasCheckpoint ? `turn ${(cp!.completedTurn ?? 0) + 1}` : '처음부터'})`);
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
            if (t.reason === AGENT_TASK_DEVICE_WAIT_REASON) {
                // 기기 대기 — 승인과 무관하다. 재개는 resumeParkedTask 가 기기 연결을 보고 판단하고, 상한을 넘기면 실패로 끝낸다.
                if (await resumeParkedTask(t.id)) { out.resumed++; continue; }
                if (deviceWaitAction({ connected: false, waitedMs: Number(t.waited_ms ?? 0), maxMs: LOCAL_BRIDGE.DEVICE_WAIT_MAX_MS }) === 'expire') {
                    await getUnifiedDatabase().updateAgentTask(t.id, { status: 'failed', error: AGENT_TASK_DEVICE_WAIT_EXPIRED_ERROR, terminalNotifyPending: true });
                    out.expired++;
                }
                continue;
            }
            if (t.reason === AGENT_TASK_BROWSER_TAKEOVER_REASON) {
                // 브라우저 넘겨받기 — 기기가 아직 넘겨받은 상태면 재개하지 않는다(다시 거절돼 주차되면 대기 시간이 처음부터 다시 잰다).
                // 돌려줬거나 상태를 모르면(알림을 놓쳤다) 재개를 시도하고, 여전히 넘겨받은 상태면 실행기가 다시 주차한다.
                const dev = LOCAL_BRIDGE.ENABLED ? getLocalBridgeRegistry().getDevice(String(t.user_id), t.device_id ?? undefined) : null;
                const waitedMs = Number(t.waited_ms ?? 0);
                const action = browserTakeoverAction({ connected: !!dev, userControl: dev?.browserUserControl === true, waitedMs, maxMs: LOCAL_BRIDGE.TAKEOVER_WAIT_MAX_MS });
                if (action === 'resume' && await resumeParkedTask(t.id)) { out.resumed++; continue; }
                if (waitedMs > LOCAL_BRIDGE.TAKEOVER_WAIT_MAX_MS) {
                    await getUnifiedDatabase().updateAgentTask(t.id, { status: 'failed', error: AGENT_TASK_BROWSER_TAKEOVER_EXPIRED_ERROR, terminalNotifyPending: true });
                    out.expired++;
                }
                continue;
            }
            if (t.has_decision) {
                if (await resumeParkedTask(t.id)) out.resumed++;
            } else if (!t.has_live_pending) {
                await new AgentTaskApprovalRepository(getPool()).expirePendingForTask(t.id, 'expired');
                // 알림 표식(174) — 실행 루프 밖의 종료라 여기서는 알리지 않고, 주기 점검이 사용자에게 알린다.
                await getUnifiedDatabase().updateAgentTask(t.id, { status: 'failed', error: AGENT_TASK_PARK_EXPIRED_ERROR, terminalNotifyPending: true });
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

/**
 * 만료 전용 스윕(`AGENT_TASK_HITL_PARK_EXPIRE_SWEEP_MS`, 본 스윕보다 짧은 주기) — 상한을 넘긴 주차 작업만 실패로 바꾼다.
 * 재개 시도·workspace 갱신은 하지 않는다(그건 본 스윕 몫이라 주기를 줄이지 않는다). 지금 재개될 수 있는 작업
 * (기기 연결됨·넘겨받기 반환됨·결정 도착)은 건드리지 않고 본 스윕·연결 즉시 경로에 맡긴다. 절대 throw 하지 않는다.
 */
export async function expireParkedTasks(): Promise<{ expired: number }> {
    const out = { expired: 0 };
    let rows;
    try {
        rows = await new AgentTaskRepository(getPool()).listParkedTasks();
    } catch (e) {
        logger.warn(`주차 만료 점검 조회 실패(건너뜀): ${e instanceof Error ? e.message : e}`);
        return out;
    }
    for (const t of rows) {
        try {
            const waitedMs = Number(t.waited_ms ?? 0);
            const dev = LOCAL_BRIDGE.ENABLED ? getLocalBridgeRegistry().getDevice(String(t.user_id), t.device_id ?? undefined) : null;
            let error: string | null = null;
            if (t.reason === AGENT_TASK_DEVICE_WAIT_REASON) {
                if (deviceWaitAction({ connected: !!dev, waitedMs, maxMs: LOCAL_BRIDGE.DEVICE_WAIT_MAX_MS }) === 'expire') error = AGENT_TASK_DEVICE_WAIT_EXPIRED_ERROR;
            } else if (t.reason === AGENT_TASK_BROWSER_TAKEOVER_REASON) {
                if (browserTakeoverAction({ connected: !!dev, userControl: dev?.browserUserControl === true, waitedMs, maxMs: LOCAL_BRIDGE.TAKEOVER_WAIT_MAX_MS }) === 'expire') error = AGENT_TASK_BROWSER_TAKEOVER_EXPIRED_ERROR;
            } else if (!t.has_decision && !t.has_live_pending) {
                await new AgentTaskApprovalRepository(getPool()).expirePendingForTask(t.id, 'expired');
                error = AGENT_TASK_PARK_EXPIRED_ERROR;
            }
            if (!error) continue;
            await getUnifiedDatabase().updateAgentTask(t.id, { status: 'failed', error, terminalNotifyPending: true });
            out.expired++;
        } catch (e) {
            logger.warn(`[${t.id}] 주차 만료 처리 실패(다음 주기에 재시도): ${e instanceof Error ? e.message : e}`);
        }
    }
    if (out.expired) logger.info(`주차 만료 점검 — 만료 ${out.expired}`);
    return out;
}
