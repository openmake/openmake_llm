/**
 * 이어가기(188) — 장기 실행 작업이 턴·토큰·컨텍스트 상한에 닿으면 끝내는 대신 후속 작업으로 잇는다.
 *
 * 순서: 인계 턴(도구 없이 "다음에 할 일") → 작업 공간 스냅숏(fork-workspace 의 턴 ref) → 선점(continued_by 조건부 UPDATE)
 * → 후속 생성(fork 와 같은 방식: 체크포인트 시드 + resume) → 디스패치. 어느 단계가 실패해도 현재 작업은 호출부가
 * 종전대로 마무리 턴으로 끝낸다(이어가기 실패는 결과에 사유만 남긴다).
 * 체인 누적 사용량은 후속 행의 continuation 에 실어 둔다 — 조회·판정이 현재 행만 보면 되게.
 *
 * @module services/agent-task/continuation
 */
import { randomUUID } from 'crypto';
import { createLogger } from '../../utils/logger';
import { AGENT_TASK_LONG_RUNNING as C } from '../../config/agent-task-long-running';
import { getUnifiedDatabase, getPool } from '../../data/models/unified-database';
import { AgentTaskRepository } from '../../data/repositories/agent-task-repository';
import { AgentTaskChainRepository } from '../../data/repositories/agent-task-chain-repository';
import { AgentTaskParkRepository } from '../../data/repositories/agent-task-park-repository';
import type { AgentTask } from '../../data/models/unified-database.types';
import type { ChatMessage } from '../../llm/types';
import type { AgentRoleState } from './role-client';
import { chatTurnWithRoleFallback } from './role-client';
import { buildHandoffSummary } from './context-handoff';
import { snapshotWorkspaceTurn } from './fork-workspace';
import { dispatchAgentTask } from './task-queue';
import type { TaskRuntime } from '../task-sandbox/runtime';
import type { ContinuationInfo, ContinuationReason, LongRunningBudget, AgentTaskUserRole, AgentTaskInputFile } from './types';
import { CONTINUATION_NEXT_STEPS_HEADING, CONTINUATION_NO_NEXT_STEPS, getContinuationNextStepsPrompt, getContinuationNotice } from '../../prompts/agent-task-continuation';

const logger = createLogger('AgentTaskContinuation');

export interface ChainBudgetState {
    canContinue: boolean;
    usedMs: number;
    usedTokens: number;
    /** 현재 세그먼트 번호(루트 0) */
    segmentIndex: number;
    limits: LongRunningBudget;
}

/** PURE: 체인 예산 상태 — 현재 작업 행·루트 행·이번 세그먼트의 활성 시간(주차 제외)·토큰으로 판정. 체인이 아니면 null. */
export function chainBudgetState(task: AgentTask, root: AgentTask | null, activeMs: number, totalTokens: number): ChainBudgetState | null {
    if (!task.chain_root_task_id || !root?.long_running) return null;
    const limits = root.long_running;
    const prev = task.continuation;
    const segmentIndex = prev?.segmentIndex ?? 0;
    const usedMs = (prev?.chainUsedMs ?? 0) + activeMs;
    const usedTokens = (prev?.chainUsedTokens ?? 0) + totalTokens;
    const canContinue = !limits.cancelled
        && usedMs < limits.maxDurationMs
        && usedTokens < limits.maxTotalTokens
        && segmentIndex + 1 < limits.maxSegments;
    return { canContinue, usedMs, usedTokens, segmentIndex, limits };
}

/** PURE: 후속 작업의 첫 사용자 메시지 — 인계 요약(system·첫 user 를 뺀 전 구간) + 다음에 할 일. */
export function buildContinuationSummary(conversation: ChatMessage[], goal: string, nextSteps: string): string {
    const head = conversation[0]?.role === 'system' ? 1 : 0;
    const first = conversation[head]?.role === 'user' ? head + 1 : head;
    const dropped = conversation.slice(first);
    return `${buildHandoffSummary(dropped, goal)}\n\n${CONTINUATION_NEXT_STEPS_HEADING}\n${nextSteps}`;
}

/** 계획(plan)에서 끝나지 않은 항목 제목들 — 인계 턴 실패 시 대체. */
function pendingPlanItems(plan: unknown): string[] {
    const items = (plan as { items?: Array<{ title?: unknown; status?: unknown }> } | null)?.items;
    if (!Array.isArray(items)) return [];
    return items.filter((i) => i && i.status !== 'done' && typeof i.title === 'string').map((i) => String(i.title));
}

/** 인계 턴 — 도구 없이 "다음에 할 일" 만 받는다. 실패·빈 답이면 계획의 미완 항목, 그것도 없으면 고정 문구. */
export async function askNextSteps(p: { roleState: AgentRoleState; conversation: ChatMessage[]; signal: AbortSignal; taskId: string; userId: string; plan: unknown }): Promise<string> {
    const max = C.HANDOFF_TURN_MAX_CHARS;
    try {
        const result = await chatTurnWithRoleFallback(p.roleState, {
            conversation: [...p.conversation, { role: 'user', content: getContinuationNextStepsPrompt(max) }],
            tools: [], signal: AbortSignal.any([p.signal, AbortSignal.timeout(C.HANDOFF_TURN_TIMEOUT_MS)]),
            taskId: p.taskId, userId: p.userId,
        });
        const text = (result.content ?? '').trim();
        if (text) return text.slice(0, max);
    } catch (e) {
        logger.warn(`[Continuation] 인계 턴 실패(계획으로 대신): ${p.taskId} — ${e instanceof Error ? e.message : String(e)}`);
    }
    const pending = pendingPlanItems(p.plan);
    if (pending.length > 0) return pending.map((t, i) => `${i + 1}. ${t}`).join('\n').slice(0, max);
    return CONTINUATION_NO_NEXT_STEPS;
}

export interface ContinueInput {
    task: AgentTask;
    root: AgentTask;
    reason: ContinuationReason;
    conversation: ChatMessage[];
    turn: number;
    roleState: AgentRoleState;
    signal: AbortSignal;
    taskRuntime: TaskRuntime | null;
    userRole: AgentTaskUserRole;
    /** 이번 세그먼트의 활성 시간(주차 제외)·누적 토큰 */
    activeMs: number;
    totalTokens: number;
}

/** 후속 세그먼트를 만들고 디스패치한다. 실패하면 { skipped: 사유 } — 호출부는 종전대로 마무리한다. */
export async function continueAsNewSegment(p: ContinueInput): Promise<{ successorId: string } | { skipped: string }> {
    const db = getUnifiedDatabase();
    const repo = new AgentTaskRepository(getPool()); // markForked
    const chainRepo = new AgentTaskChainRepository(getPool()); // claimContinuation·resetContinuation (Task 2 분리, Ruling 2)
    const state = chainBudgetState(p.task, p.root, p.activeMs, p.totalTokens);
    if (!state) return { skipped: '체인 작업이 아닙니다' };
    if (p.root.long_running?.cancelled || p.task.status === 'cancelled') return { skipped: '체인이 취소되었습니다' };
    if (!state.canContinue) return { skipped: '체인 예산 소진' };

    const nextSteps = await askNextSteps({ roleState: p.roleState, conversation: p.conversation, signal: p.signal, taskId: p.task.id, userId: String(p.task.user_id), plan: p.task.plan });
    // 장기 실행은 전역 플래그(FORK_WORKSPACE_RESTORE_ENABLED)와 무관하게 스냅숏을 강제한다 — 후속 세그먼트가 파일을 이어받는 유일한 길.
    if (p.taskRuntime) await snapshotWorkspaceTurn(p.taskRuntime, p.turn, { force: true }).catch((e) => logger.warn(`[Continuation] 작업 공간 스냅숏 실패(후속이 복원 실패로 멈출 수 있음): ${e instanceof Error ? e.message : String(e)}`));

    const successorId = randomUUID();
    if (!(await chainRepo.claimContinuation(p.task.id, successorId))) return { skipped: '이미 다른 실행이 이어갔습니다' };

    const segmentIndex = state.segmentIndex + 1;
    const summary = buildContinuationSummary(p.conversation, p.task.goal, nextSteps);
    const continuation: ContinuationInfo = { fromTaskId: p.task.id, segmentIndex, reason: p.reason, summary, chainUsedMs: state.usedMs, chainUsedTokens: state.usedTokens };
    // fork 와 같은 시드: [원 system 그대로, 목표, 인계 요약+안내] — 체크포인트와 resume 둘 다 이 배열을 쓴다
    const systemMsg = p.conversation[0]?.role === 'system' ? p.conversation[0] : { role: 'system' as const, content: '' };
    const seeded: ChatMessage[] = [systemMsg, { role: 'user', content: p.task.goal }, { role: 'user', content: `${summary}\n\n${getContinuationNotice(segmentIndex, p.reason)}` }];
    try {
        const created = await db.createAgentTask({
            id: successorId, userId: String(p.task.user_id), goal: p.task.goal, maxTurns: p.task.max_turns,
            inputFiles: p.task.input_files ?? undefined, inputImages: p.task.input_images ?? undefined,
            executor: p.task.executor === 'local' ? 'local' : undefined, deviceId: p.task.device_id ?? undefined, folderRel: p.task.folder_rel ?? undefined,
            chainRootTaskId: p.root.id, continuedFromTaskId: p.task.id, continuation,
        });
        if (!created) throw new Error('작업을 저장하지 못했습니다');
        await db.updateAgentTask(successorId, { checkpoint: { conversation: seeded, completedTurn: -1 }, ...(p.task.plan ? { plan: p.task.plan } : {}) });
        await repo.markForked(successorId, p.task.id, p.turn).catch(() => { /* 표시용 */ });
        const park = new AgentTaskParkRepository(getPool());
        if (p.task.approval_policy) await park.setApprovalPolicy(successorId, p.task.approval_policy).catch(() => { /* 물려주기 실패 무시 */ });
        if (p.task.thinking_level) await park.setThinkingLevel(successorId, p.task.thinking_level).catch(() => { /* 물려주기 실패 무시 */ });
    } catch (e) {
        await chainRepo.resetContinuation(p.task.id, successorId).catch(() => { /* 되돌리기 실패는 다음 판정이 skipped 로 본다 */ });
        return { skipped: `후속 작업 저장 실패: ${e instanceof Error ? e.message : String(e)}` };
    }

    const { AgentTaskService } = await import('../AgentTaskService'); // 순환 import 회피
    const service = new AgentTaskService();
    const seededConversation = seeded; // 체크포인트에 쓴 것과 같은 배열 — DB 를 다시 읽지 않는다
    await dispatchAgentTask({
        taskId: successorId, userId: String(p.task.user_id),
        run: () => service.execute({
            taskId: successorId, goal: p.task.goal, userId: String(p.task.user_id), userRole: p.userRole, maxTurns: p.task.max_turns,
            files: Array.isArray(p.task.input_files) ? p.task.input_files as AgentTaskInputFile[] : undefined,
            images: Array.isArray(p.task.input_images) ? p.task.input_images as string[] : undefined,
            executor: p.task.executor === 'local' ? 'local' : undefined, deviceId: p.task.device_id ?? undefined, folderRel: p.task.folder_rel ?? undefined,
            resume: { conversation: seededConversation, fromTurn: 0, fromStep: 0, ...(p.task.plan ? { plan: p.task.plan } : {}) },
        }),
    });
    logger.info(`[Continuation] 이어가기: ${p.task.id} → ${successorId} (세그먼트 ${segmentIndex}, 사유 ${p.reason}, 누적 ${state.usedMs}ms/${state.usedTokens}tok)`);
    return { successorId };
}
