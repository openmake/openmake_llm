/**
 * 이어가기(188) — 장기 실행 작업이 턴·토큰·컨텍스트 상한에 닿으면 끝내는 대신 후속 작업으로 잇는다.
 *
 * 순서: 인계 턴(도구 없이 "다음에 할 일") → 작업 공간 스냅숏(fork-workspace 의 턴 ref) → **한 트랜잭션**으로 선점(continued_by
 * 조건부 UPDATE)과 완전히 시드된 후속 INSERT(체크포인트·fork·plan·실효 정책·실행 소유권, #1473) → 커밋 뒤 디스패치.
 * 커밋 전에 죽으면 아무것도 남지 않고, 커밋 뒤 디스패치 전에 죽으면 소유권 점검(R2)이 완성된 후속을 회수한다.
 * 어느 단계가 실패해도 현재 작업은 호출부가 종전대로 마무리 턴으로 끝낸다(이어가기 실패는 결과에 사유만 남긴다).
 * 체인 누적 사용량은 후속 행의 continuation 에 실어 둔다 — 조회·판정이 현재 행만 보면 되게.
 *
 * @module services/agent-task/continuation
 */
import { randomUUID } from 'crypto';
import { createLogger } from '../../utils/logger';
import { AGENT_TASK_LONG_RUNNING as C } from '../../config/agent-task-long-running';
import { AGENT_TASK_LIMITS } from '../../config/runtime-limits';
import { getUnifiedDatabase, getPool } from '../../data/models/unified-database';
import { AgentTaskRepository } from '../../data/repositories/agent-task-repository';
import { AgentTaskChainRepository } from '../../data/repositories/agent-task-chain-repository';
import { AgentTaskLeaseRepository, hasLiveLease } from '../../data/repositories/agent-task-lease-repository';
import { leaseOwner } from '../../config/lease-owner';
import type { AgentTask } from '../../data/models/unified-database.types';
import type { ChatMessage } from '../../llm/types';
import type { AgentRoleState } from './role-client';
import { chatTurnWithRoleFallback } from './role-client';
import { buildHandoffSummary } from './context-handoff';
import { snapshotWorkspaceTurn } from './fork-workspace';
import { dispatchAgentTask } from './task-queue';
import type { TaskRuntime } from '../task-sandbox/runtime';
import type { ContinuationInfo, ContinuationReason, LongRunningBudget, AgentTaskUserRole, AgentTaskInputFile, AgentTaskRunInput, AgentTaskThinkingLevel } from './types';
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
export async function askNextSteps(p: { roleState: AgentRoleState; conversation: ChatMessage[]; signal: AbortSignal; taskId: string; userId: string; plan: unknown; reason: ContinuationReason }): Promise<string> {
    const max = C.HANDOFF_TURN_MAX_CHARS;
    try {
        const result = await chatTurnWithRoleFallback(p.roleState, {
            conversation: [...p.conversation, { role: 'user', content: getContinuationNextStepsPrompt(max, p.reason) }],
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
    /** 이번 실행의 실효 승인 정책·추론 수준 — 후속이 물려받는다(없으면 현재 행 값) */
    approvalPolicy?: AgentTaskRunInput['approvalPolicy'];
    thinkingLevel?: AgentTaskThinkingLevel;
    /** 이번 세그먼트의 활성 시간(주차 제외)·누적 토큰 */
    activeMs: number;
    totalTokens: number;
}

type ContinueOutcome = { successorId: string } | { skipped: string };
const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/**
 * 선점을 놓쳤을 때 — 이미 만들어진 후속을 따른다(설계: "선점 실패면 이미 만들어진 쪽을 따른다").
 * 선점·디스패치 뒤 completed/continued 갱신 전에 프로세스가 죽고 부팅 복구로 이 작업이 다시 돌면 여기로 온다.
 * 살아 있음 판정(2026-10-22 R3, #1473) — 디스패치되지 못한 pending 후속을 살아 있다고 보면 체인이 조용히 멈춘다:
 * - running·paused·queued·completed → 살아 있음.
 * - pending 이고 소유권이 있다 → 살아 있음. 살아 있으면 쥔 쪽이 실행하고, 지났으면 소유권 점검(R2)의 원자 takeover 가 회수한다
 *   — 여기서 직접 디스패치하면 R2 와 두 곳이 같이 실행한다.
 * - pending 이고 updated_at 이 LEASE_MS 이내 → 살아 있음(다른 실행이 디스패치 중).
 * - pending 이고 소유권을 잡은 적 없고(lease_until NULL — 레거시·소유권 꺼짐) 오래됐고 체크포인트 대화가 있으면 → 원자 claim 을
 *   잡은 한 곳만 그 대화로 재디스패치한다(claim 을 놓치면 다른 복구자가 잡은 것 — 살아 있음).
 * 살아 있으면(재디스패치 포함) 그 id 를 돌려 호출부가 이 작업을 '이어짐'으로 끝내게 하고(종료 알림 없음),
 * 후속 행이 없거나 실패·취소·체크포인트 없음이면 skipped — 호출부는 종전대로 마무리한다.
 */
async function followExistingSuccessor(taskId: string, p: Pick<ContinueInput, 'userRole'>): Promise<ContinueOutcome> {
    const db = getUnifiedDatabase();
    const cur = await db.getAgentTask(taskId).catch(() => undefined);
    const existingId = cur?.continued_by_task_id;
    const existing = existingId ? await db.getAgentTask(existingId).catch(() => undefined) : undefined;
    const skipped = { skipped: `이미 다른 실행이 이어갔습니다${existingId ? ` (후속 ${existingId} 없음·실패·취소)` : ''}` };
    if (!existing) return skipped;
    if (['running', 'paused', 'queued', 'completed'].includes(existing.status)) {
        logger.info(`[Continuation] 선점 실패 — 이미 만들어진 후속을 따른다: ${taskId} → ${existing.id} (${existing.status})`);
        return { successorId: existing.id };
    }
    if (existing.status !== 'pending') return skipped;
    if (existing.lease_until != null) {
        logger.info(`[Continuation] 선점 실패 — 후속이 소유권을 가졌다(${hasLiveLease(existing.lease_until) ? '살아 있음' : '지남 — 소유권 점검이 회수'}): ${taskId} → ${existing.id}`);
        return { successorId: existing.id };
    }
    if (Date.now() - new Date(existing.updated_at).getTime() <= AGENT_TASK_LIMITS.LEASE_MS) {
        logger.info(`[Continuation] 선점 실패 — 후속이 아직 살아 있다(pending·방금 갱신): ${taskId} → ${existing.id}`);
        return { successorId: existing.id };
    }
    const seeded = (existing.checkpoint as { conversation?: unknown } | null | undefined)?.conversation;
    if (!Array.isArray(seeded)) return { skipped: `이미 다른 실행이 이어갔습니다 (후속 ${existing.id} 체크포인트 없음)` };
    try {
        const lease = AGENT_TASK_LIMITS.LEASE_ENABLED ? { owner: leaseOwner(), leaseMs: AGENT_TASK_LIMITS.LEASE_MS } : undefined;
        if (!(await new AgentTaskLeaseRepository(getPool()).claimUnleasedPendingForRedispatch(existing.id, AGENT_TASK_LIMITS.LEASE_MS, lease))) {
            logger.info(`[Continuation] 선점 실패 — 다른 복구자가 후속 재디스패치를 잡았다: ${taskId} → ${existing.id}`);
            return { successorId: existing.id };
        }
        await dispatchSuccessor({
            successor: existing, seeded: seeded as ChatMessage[], userRole: p.userRole,
            approvalPolicy: (existing.approval_policy ?? undefined) as AgentTaskRunInput['approvalPolicy'],
            thinkingLevel: (existing.thinking_level ?? undefined) as AgentTaskThinkingLevel | undefined,
        });
    } catch (e) {
        return { skipped: `후속 재디스패치 실패: ${errMsg(e)}` };
    }
    logger.warn(`[Continuation] 디스패치되지 못한 후속을 다시 디스패치: ${taskId} → ${existing.id}`);
    return { successorId: existing.id };
}

/** 후속 디스패치 — resume 은 체크포인트에 쓴 것과 같은 seeded 배열을 쓴다(DB 를 다시 읽지 않는다). */
async function dispatchSuccessor(p: { successor: AgentTask; seeded: ChatMessage[]; userRole: AgentTaskUserRole; approvalPolicy?: AgentTaskRunInput['approvalPolicy']; thinkingLevel?: AgentTaskThinkingLevel }): Promise<void> {
    const s = p.successor;
    const { AgentTaskService } = await import('../AgentTaskService'); // 순환 import 회피
    const service = new AgentTaskService();
    await dispatchAgentTask({
        taskId: s.id, userId: String(s.user_id),
        run: () => service.execute({
            taskId: s.id, goal: s.goal, userId: String(s.user_id), userRole: p.userRole, maxTurns: s.max_turns,
            files: Array.isArray(s.input_files) ? s.input_files as AgentTaskInputFile[] : undefined,
            images: Array.isArray(s.input_images) ? s.input_images as string[] : undefined,
            executor: s.executor === 'local' ? 'local' : undefined, deviceId: s.device_id ?? undefined, folderRel: s.folder_rel ?? undefined,
            approvalPolicy: p.approvalPolicy, thinkingLevel: p.thinkingLevel,
            resume: { conversation: p.seeded, fromTurn: 0, fromStep: 0, ...(s.plan ? { plan: s.plan } : {}) },
        }),
    });
}

/** 정리 대상 추적 — 예상 밖 예외에서도 abandon 이 무엇을 되돌릴지 안다. */
interface ContinueTrack { successorId: string; claimed: boolean; rowCreated: boolean }

/**
 * 후속 세그먼트를 만들고 디스패치한다. 실패하면 { skipped: 사유 } — 호출부는 종전대로 마무리한다.
 * 어떤 예외도 밖으로 던지지 않는다 — 던지면 호출부의 마무리 폴백을 건너뛰고 작업이 failed 로 끝난다.
 */
export async function continueAsNewSegment(p: ContinueInput): Promise<ContinueOutcome> {
    const db = getUnifiedDatabase();
    const chainRepo = new AgentTaskChainRepository(getPool()); // resetContinuation — 선점은 원자적 후속 생성(#1473)이 한다
    const track: ContinueTrack = { successorId: '', claimed: false, rowCreated: false };
    // 행을 만든 뒤 실패하면 고아 후속(체크포인트·디스패치 없는 pending)이 남지 않게 failed 로 닫고, 쥔 선점을 되돌린다
    const abandon = async (why: string): Promise<{ skipped: string }> => {
        if (track.rowCreated) await db.updateAgentTask(track.successorId, { status: 'failed', error: `이어가기 준비 실패: ${why}` }).catch((e) => logger.warn(`[Continuation] 고아 후속 닫기 실패: ${track.successorId} — ${errMsg(e)}`));
        if (track.claimed) await chainRepo.resetContinuation(p.task.id, track.successorId).catch((e) => logger.warn(`[Continuation] 선점 되돌리기 실패(다음 판정은 선점 실패로 본다): ${p.task.id} — ${errMsg(e)}`));
        return { skipped: why };
    };
    try {
        return await runContinuation(p, track, abandon);
    } catch (e) {
        return abandon(`이어가기 예외: ${errMsg(e)}`);
    }
}

async function runContinuation(p: ContinueInput, track: ContinueTrack, abandon: (why: string) => Promise<{ skipped: string }>): Promise<ContinueOutcome> {
    const db = getUnifiedDatabase();
    const repo = new AgentTaskRepository(getPool()); // createContinuationSuccessor(#1473)
    const state = chainBudgetState(p.task, p.root, p.activeMs, p.totalTokens);
    if (!state) return { skipped: '체인 작업이 아닙니다' };
    if (p.root.long_running?.cancelled || p.task.status === 'cancelled') return { skipped: '체인이 취소되었습니다' };
    if (!state.canContinue) return { skipped: '체인 예산 소진' };

    const nextSteps = await askNextSteps({ roleState: p.roleState, conversation: p.conversation, signal: p.signal, taskId: p.task.id, userId: String(p.task.user_id), plan: p.task.plan, reason: p.reason });
    // 장기 실행은 전역 플래그(FORK_WORKSPACE_RESTORE_ENABLED)와 무관하게 스냅숏을 강제한다 — 후속 세그먼트가 파일을 이어받는 유일한 길.
    if (p.taskRuntime) await snapshotWorkspaceTurn(p.taskRuntime, p.turn, { force: true }).catch((e) => logger.warn(`[Continuation] 작업 공간 스냅숏 실패(후속이 복원 실패로 멈출 수 있음): ${errMsg(e)}`));

    // 인계 턴(최대 HANDOFF_TURN_TIMEOUT_MS) 동안 취소됐을 수 있다 — 중단 신호와 루트의 취소 표식을 선점 직전에 다시 본다
    if (p.signal.aborted) return { skipped: '체인이 취소되었습니다' };
    const freshRoot = await db.getAgentTask(p.root.id).catch(() => undefined);
    if (freshRoot?.long_running?.cancelled) return { skipped: '체인이 취소되었습니다' };

    const successorId = randomUUID();
    track.successorId = successorId;
    // 후속이 물려받을 승인 정책·추론 수준 — 실행의 실효 값(요청 본문 override 포함), 없으면 현재 행 값
    const approvalPolicy = (p.approvalPolicy ?? p.task.approval_policy ?? undefined) as AgentTaskRunInput['approvalPolicy'];
    const thinkingLevel = (p.thinkingLevel ?? p.task.thinking_level ?? undefined) as AgentTaskThinkingLevel | undefined;

    const segmentIndex = state.segmentIndex + 1;
    const summary = buildContinuationSummary(p.conversation, p.task.goal, nextSteps);
    const continuation: ContinuationInfo = { fromTaskId: p.task.id, segmentIndex, reason: p.reason, summary, chainUsedMs: state.usedMs, chainUsedTokens: state.usedTokens };
    // fork 와 같은 시드: [원 system 그대로, 목표, 인계 요약+안내] — 체크포인트와 resume 둘 다 이 배열을 쓴다
    const systemMsg = p.conversation[0]?.role === 'system' ? p.conversation[0] : { role: 'system' as const, content: '' };
    const seeded: ChatMessage[] = [systemMsg, { role: 'user', content: p.task.goal }, { role: 'user', content: `${summary}\n\n${getContinuationNotice(segmentIndex, p.reason)}` }];
    // 선점과 완전한 후속을 한 트랜잭션으로(#1473) — forked_from·턴은 후속의 작업 공간 복원(initWorkspaceBaseline)이, 승인 정책·추론 수준은
    // 재개 실행이 행에서 읽는다. 소유권은 이 프로세스의 기존 owner·TTL — 디스패치된 실행이 같은 owner 로 이어 잡고, 디스패치 전에 죽으면
    // 만료 뒤 소유권 점검(R2)이 회수한다. 소유권을 끄면 비워 둔다(R2 가 없으니 레거시 R3 가 회수한다).
    const lease = AGENT_TASK_LIMITS.LEASE_ENABLED ? { owner: leaseOwner(), leaseMs: AGENT_TASK_LIMITS.LEASE_MS } : undefined;
    let claimed: boolean;
    try {
        claimed = await repo.createContinuationSuccessor({
            parentTaskId: p.task.id,
            create: {
                id: successorId, userId: String(p.task.user_id), goal: p.task.goal, maxTurns: p.task.max_turns,
                inputFiles: p.task.input_files ?? undefined, inputImages: p.task.input_images ?? undefined,
                executor: p.task.executor === 'local' ? 'local' : undefined, deviceId: p.task.device_id ?? undefined, folderRel: p.task.folder_rel ?? undefined,
                chainRootTaskId: p.root.id, continuedFromTaskId: p.task.id, continuation,
            },
            checkpoint: { conversation: seeded, completedTurn: -1 }, plan: p.task.plan ?? undefined, forkedFromTurn: p.turn,
            approvalPolicy, thinkingLevel, lease,
        });
    } catch (e) {
        return abandon(`후속 작업 저장 실패: ${errMsg(e)}`); // 트랜잭션이 되돌렸다 — 되돌릴 선점·행이 없다
    }
    if (!claimed) return followExistingSuccessor(p.task.id, p);
    track.claimed = true;
    track.rowCreated = true;

    try {
        // 후속 행은 현재 작업의 goal·max_turns·첨부·실행기·plan 을 그대로 물려받았다 — 같은 값으로 디스패치
        await dispatchSuccessor({ successor: { ...p.task, id: successorId }, seeded, userRole: p.userRole, approvalPolicy, thinkingLevel });
    } catch (e) {
        return abandon(`디스패치 실패: ${errMsg(e)}`);
    }
    logger.info(`[Continuation] 이어가기: ${p.task.id} → ${successorId} (세그먼트 ${segmentIndex}, 사유 ${p.reason}, 누적 ${state.usedMs}ms/${state.usedTokens}tok)`);
    return { successorId };
}
