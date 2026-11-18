/**
 * 실행 루프(AgentTaskService)와 이어가기(continuation)를 잇는 얇은 층 — 서비스 파일의 줄 수를 지키기 위해 분리.
 * @module services/agent-task/continuation-hook
 */
import { getUnifiedDatabase, getPool } from '../../data/models/unified-database';
import { AGENT_TASK_LONG_RUNNING } from '../../config/agent-task-long-running';
import { AGENT_TASK_LIMITS } from '../../config/runtime-limits';
import type { AgentTask } from '../../data/models/unified-database.types';
import type { AgentTaskIsolation } from '@openmake/shared-types';
import { AgentTaskChainRepository } from '../../data/repositories/agent-task-chain-repository';
import type { ChatMessage, ToolDefinition } from '../../llm/types';
import type { TaskRuntime } from '../task-sandbox/runtime';
import { initWorkspaceBaseline } from './code-diff';
import { chainBudgetState, continueAsNewSegment, followExistingSuccessor, type ContinueInput } from './continuation';
import { contextUsageRatio } from './turn-context';
import { applyTurnResourceGates } from './turn-gate';
import { HANDOFF_SUMMARY_MARKER } from '../../prompts/agent-task-context';
import { createLogger } from '../../utils/logger';

const logger = createLogger('AgentTaskContinuation');

export interface ChainContext { task: AgentTask; root: AgentTask }

/** 체인 작업이면 현재 행과 루트 행. 루트 자신이면 둘이 같다. 이미 읽은 행(preloaded)을 넘기면 체인이 아닐 때 DB 를 다시 읽지 않는다. */
export async function loadChainContext(taskId: string, preloaded?: AgentTask): Promise<ChainContext | null> {
    const db = getUnifiedDatabase();
    const task = preloaded ?? await db.getAgentTask(taskId);
    if (!task?.chain_root_task_id) return null;
    const root = task.chain_root_task_id === task.id ? task : await db.getAgentTask(task.chain_root_task_id);
    return root?.long_running ? { task, root } : null;
}

/**
 * PURE: 실효 세그먼트 시간 상한 — 체인 작업이면 min(세그먼트 상한 totalTimeoutMs, 체인 남은 시간 = maxDurationMs − 앞 세그먼트 누적 chainUsedMs).
 * 체인 예산은 턴 시작의 판정(chainBudgetState)만 보던 탓에, 체인 남은 시간이 세그먼트 상한보다 짧아도 마지막 세그먼트가 끝까지 돌았다.
 * 하한: 지금까지의 활성 시간 + 한 턴 예산(TURN_TIME_BUDGET_MS) — 남은 시간이 그보다 짧으면(0 이하 포함) 최소 한 턴은 돈다.
 * 체인이 아니면 totalTimeoutMs 그대로. 서비스는 이 값을 assertWithinLimits·턴 호출 예산·'time' 판정(segmentTimeoutMs)에 함께 쓴다.
 */
export function effectiveSegmentTimeoutMs(ctx: ChainContext | null, totalTimeoutMs: number, elapsedActiveMs = 0): number {
    const limits = ctx?.root.long_running;
    if (!ctx || !limits) return totalTimeoutMs;
    const remaining = limits.maxDurationMs - (ctx.task.continuation?.chainUsedMs ?? 0);
    return Math.min(totalTimeoutMs, Math.max(remaining, elapsedActiveMs + AGENT_TASK_LIMITS.TURN_TIME_BUDGET_MS));
}

/**
 * turn-gate 의 chain 입력 — 체인이 아니면 undefined(게이트는 종전과 같다).
 * timeUp: 이번 세그먼트 활성 시간이 세그먼트 시간 상한
 * (서비스의 totalTimeoutMs)의 SEGMENT_TIME_RATIO 이상 — assertWithinLimits 가 'timeout' 으로 체인을 failed 로 끝내기 전에 잇는다(설계 §2.1).
 */
export function chainGateInput(ctx: ChainContext | null, conversation: ChatMessage[], tools: ToolDefinition[], model: string, activeMs: number, totalTokens: number, segmentTimeoutMs?: number): { canContinue: boolean; contextRatio: number | null; timeUp: boolean } | undefined {
    if (!ctx) return undefined;
    const state = chainBudgetState(ctx.task, ctx.root, activeMs, totalTokens);
    if (!state) return undefined;
    const timeUp = segmentTimeoutMs != null && activeMs >= segmentTimeoutMs * AGENT_TASK_LONG_RUNNING.SEGMENT_TIME_RATIO;
    return { canContinue: state.canContinue, contextRatio: contextUsageRatio(conversation, tools, model), timeUp };
}

/**
 * PURE: 이 세그먼트가 일을 했는가(폭주 방지) — turns 사유와 같은 turn > startTurn 에 더해, 마지막 인계 요약
 * (후속 시드·컨텍스트 접기) 뒤에 도구 일 — tool 메시지 또는 tool_calls 가 있는 assistant 메시지 — 이 하나라도 있어야 한다.
 * 도구 없는 텍스트 답은 진행이 아니다: 채택됐으면 작업이 끝났을 것이고, 채택되지 않았으면(산출물 재촉 등) 일이 아니다.
 * 시드+도구 스키마만으로 컨텍스트 기준을 넘는 작은 예산에서 첫 턴마다 이어가 일 없이 세그먼트를 태우던 것
 * (라이브 2차: 45초에 4세그먼트, 누적 0tok)과, 첫 턴 마무리 턴의 채택 안 된 텍스트 답을 진행으로 보고 잇던 것을 막는다.
 */
export function segmentHasProgress(conversation: ChatMessage[], turn: number, startTurn: number): boolean {
    if (turn <= startTurn) return false;
    let from = 0;
    conversation.forEach((m, i) => { if (m.role === 'user' && typeof m.content === 'string' && m.content.includes(HANDOFF_SUMMARY_MARKER)) from = i + 1; });
    return conversation.slice(from).some((m) => m.role === 'tool' || (m.role === 'assistant' && !!m.tool_calls?.length));
}

/** segmentTimeoutMs: 서비스의 세그먼트 시간 상한(totalTimeoutMs) — 'time' 이어가기 판정용 */
type FinishInput = Omit<ContinueInput, 'task' | 'root'> & { ctx: ChainContext; segmentTimeoutMs?: number; update: (u: { status: 'completed'; completionPath: string; result: string; progress: number }) => Promise<void> };

/** 후속을 만들고 현재 작업을 '이어짐' 으로 마감. 실패면 false — 호출부가 종전 마무리 턴으로 간다. */
export async function finishAsContinued(p: FinishInput): Promise<boolean> {
    const outcome = await continueAsNewSegment({ ...p, task: p.ctx.task, root: p.ctx.root });
    if ('skipped' in outcome) { logger.info(`[Continuation] 이어가기 건너뜀: ${p.ctx.task.id} — ${outcome.skipped}`); return false; }
    await p.update({ status: 'completed', completionPath: 'continued', progress: 100, result: `이어가기: 후속 작업 ${outcome.successorId} 에서 계속합니다 (사유: ${p.reason}).` });
    return true;
}

type GateInput = Omit<Parameters<typeof applyTurnResourceGates>[0], 'chain'>;
type GateResult = Awaited<ReturnType<typeof applyTurnResourceGates>>;

/**
 * 턴 자원 게이트 + 이어가기 — 서비스 루프의 호출 한 번. 이어졌으면 gate=null(루프 종료).
 * 이어가기에 실패하면 체인을 끄고(chain=null) 같은 턴을 종전 게이트로 다시 판정한다 — 이 턴이 종전 마무리 턴(사유·도구 차단·nudge)이 되고,
 * 이후 턴도 종전과 같다(매 턴 인계 턴을 다시 부르지 않는다). 첫 판정의 다른 nudge 는 flags 가 막아 두 번 들어가지 않는다.
 */
export async function gateTurnWithContinuation(p: { gate: GateInput; chain: ChainContext | null; model: string; cont: Omit<FinishInput, 'ctx' | 'reason' | 'conversation' | 'turn' | 'totalTokens'> }): Promise<{ gate: GateResult | null; chain: ChainContext | null }> {
    const g = p.gate;
    const chainIn = chainGateInput(p.chain, g.conversation, g.tools, p.model, p.cont.activeMs, g.totalTokens, p.cont.segmentTimeoutMs);
    // 폭주 방지: 진행 없는 세그먼트는 이어가지 않는다 — 게이트는 종전과 같다(컨텍스트 압박 → 접기·마무리 턴). 체인은 끄지 않는다
    const stalled = !!chainIn?.canContinue && !segmentHasProgress(g.conversation, g.turn, g.startTurn);
    const first = await applyTurnResourceGates({ ...g, chain: chainIn && { ...chainIn, canContinue: chainIn.canContinue && !stalled } });
    if (stalled && (first.finalTurnReason || chainIn!.timeUp || (chainIn!.contextRatio ?? 0) >= AGENT_TASK_LONG_RUNNING.CONTINUE_AT_RATIO)) {
        logger.warn(`[Continuation] 진행 없음 — 이어가기 보류: ${g.taskId} (턴 ${g.turn}, 시작 ${g.startTurn}, 컨텍스트 ${chainIn!.contextRatio ?? '-'})`);
    }
    if (!first.continuationReason || !p.chain) return { gate: first, chain: p.chain };
    if (await finishAsContinued({ ...p.cont, ctx: p.chain, reason: first.continuationReason, conversation: g.conversation, turn: g.turn, totalTokens: g.totalTokens })) return { gate: null, chain: p.chain };
    return { gate: await applyTurnResourceGates({ ...g, stepNumber: first.stepNumber }), chain: null };
}

/**
 * PURE: 로컬 이어받은 세그먼트가 앞 세그먼트와 같은 자리에서 도는가(D3). 앞 기록이 없으면(옛 행·브랜치 없는 응답) 판단 근거가 없어 통과.
 * worktree 는 같은 worktreeRel·branch 여야 하고(outcome 은 보지 않는다), direct 는 이번도 direct 여야 한다(앞 변경은 사용자 폴더에 있다).
 */
export function sameSegmentWorkspace(prev: AgentTaskIsolation | null | undefined, cur: AgentTaskIsolation | null | undefined): boolean {
    if (!prev) return true;
    if (prev.state === 'direct') return cur?.state === 'direct';
    return cur?.state === 'worktree' && cur.worktreeRel === prev.worktreeRel && cur.branch === prev.branch;
}

/**
 * 작업 공간 기준점·복원 — 이어받은 세그먼트(continuation 있음)는 code-diff 설정과 무관하게 강제 복원한다(188).
 * 샌드박스 실행기에서 복원에 실패하면 되풀이를 막기 위해 루트에 취소 표식을 남기고 세그먼트를 실패시킨다.
 * 로컬 실행기는 스냅숏 복원 대상이 아니다 — 대신 앞 세그먼트와 같은 자리(같은 worktree, 또는 둘 다 직접 실행)인지 보고,
 * 다르면 같은 길로 멈춘다(앞 변경 없이 시작하거나 사용자 폴더를 직접 고치는 것보다 낫다).
 */
export async function prepareSegmentWorkspace(runtime: TaskRuntime, preTask: AgentTask | undefined, codeDiffEnabled: boolean, executor: 'sandbox' | 'local' | undefined): Promise<void> {
    const continued = !!preTask?.continuation;
    if (!codeDiffEnabled && !continued) return;
    const restored = await initWorkspaceBaseline(runtime, preTask, { forceRestore: continued });
    if (!continued || restored) return;
    if (executor === 'local') {
        const fromId = preTask?.continuation?.fromTaskId;
        // 조회 실패(DB 오류)는 '기록 없음' 이 아니다 — 확인할 수 없으면 멈춘다(닫힌 실패). 행 없음·앞 id 없음은 종전대로 기록 없음으로 본다.
        const prev = fromId ? await getUnifiedDatabase().getAgentTask(fromId).then((r) => ({ row: r }), () => null) : { row: undefined };
        if (prev && sameSegmentWorkspace(prev.row?.isolation, runtime.isolation)) return;
        logger.warn(`[Continuation] 앞 세그먼트와 작업 자리가 다르다 — 체인을 멈춘다: ${preTask?.id} (앞 ${prev ? JSON.stringify(prev.row?.isolation) : '조회 실패'}, 이번 ${JSON.stringify(runtime.isolation)})`);
    }
    if (preTask?.chain_root_task_id) await new AgentTaskChainRepository(getPool()).markChainCancelled(preTask.chain_root_task_id).catch(() => { /* 표식 실패 무시 */ });
    throw new Error('이어받은 작업 공간을 복원하지 못했습니다(workspace_restore_failed) — 체인을 멈춥니다');
}

/**
 * 이미 후속을 만든 세그먼트의 재실행(부팅 복구·소유권 회수, 설계 §7 위험 4) — 도구를 돌리기 전에 그 후속을 따라 '이어짐' 으로 마감한다.
 * 로컬 실행은 후속과 같은 worktree 를 쓰므로, 턴 중간 체크포인트의 남은 호출을 먼저 실행하면 후속과 같은 폴더를 동시에 고친다.
 * 후속이 없거나 따를 수 없으면(실패·취소) false — 호출부는 종전대로 재개한다(겹칠 실행이 없다).
 */
export async function finishIfAlreadyContinued(p: { preTask: AgentTask | undefined; userRole: ContinueInput['userRole']; update: FinishInput['update'] }): Promise<boolean> {
    if (!p.preTask?.continued_by_task_id) return false;
    const outcome = await followExistingSuccessor(p.preTask.id, { userRole: p.userRole });
    if ('skipped' in outcome) { logger.info(`[Continuation] 재실행 — 후속을 따를 수 없어 종전대로 재개: ${p.preTask.id} — ${outcome.skipped}`); return false; }
    await p.update({ status: 'completed', completionPath: 'continued', progress: 100, result: `이어가기: 후속 작업 ${outcome.successorId} 에서 계속합니다 (재실행 — 이미 이어졌음).` });
    return true;
}
