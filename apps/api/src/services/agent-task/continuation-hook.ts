/**
 * 실행 루프(AgentTaskService)와 이어가기(continuation)를 잇는 얇은 층 — 서비스 파일의 줄 수를 지키기 위해 분리.
 * @module services/agent-task/continuation-hook
 */
import { getUnifiedDatabase, getPool } from '../../data/models/unified-database';
import { AGENT_TASK_LONG_RUNNING } from '../../config/agent-task-long-running';
import type { AgentTask } from '../../data/models/unified-database.types';
import { AgentTaskChainRepository } from '../../data/repositories/agent-task-chain-repository';
import type { ChatMessage, ToolDefinition } from '../../llm/types';
import type { TaskRuntime } from '../task-sandbox/runtime';
import { initWorkspaceBaseline } from './code-diff';
import { chainBudgetState, continueAsNewSegment, type ContinueInput } from './continuation';
import { contextUsageRatio } from './turn-context';
import { applyTurnResourceGates } from './turn-gate';

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

/** segmentTimeoutMs: 서비스의 세그먼트 시간 상한(totalTimeoutMs) — 'time' 이어가기 판정용 */
type FinishInput = Omit<ContinueInput, 'task' | 'root'> & { ctx: ChainContext; segmentTimeoutMs?: number; update: (u: { status: 'completed'; completionPath: string; result: string; progress: number }) => Promise<void> };

/** 후속을 만들고 현재 작업을 '이어짐' 으로 마감. 실패면 false — 호출부가 종전 마무리 턴으로 간다. */
export async function finishAsContinued(p: FinishInput): Promise<boolean> {
    const outcome = await continueAsNewSegment({ ...p, task: p.ctx.task, root: p.ctx.root });
    if ('skipped' in outcome) return false;
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
    const first = await applyTurnResourceGates({ ...g, chain: chainGateInput(p.chain, g.conversation, g.tools, p.model, p.cont.activeMs, g.totalTokens, p.cont.segmentTimeoutMs) });
    if (!first.continuationReason || !p.chain) return { gate: first, chain: p.chain };
    if (await finishAsContinued({ ...p.cont, ctx: p.chain, reason: first.continuationReason, conversation: g.conversation, turn: g.turn, totalTokens: g.totalTokens })) return { gate: null, chain: p.chain };
    return { gate: await applyTurnResourceGates({ ...g, stepNumber: first.stepNumber }), chain: null };
}

/**
 * 작업 공간 기준점·복원 — 이어받은 세그먼트(continuation 있음)는 code-diff 설정과 무관하게 강제 복원한다(188).
 * 샌드박스 실행기에서 복원에 실패하면 되풀이를 막기 위해 루트에 취소 표식을 남기고 세그먼트를 실패시킨다.
 * 로컬 실행기는 같은 폴더를 쓰므로 복원 대상이 아니다.
 */
export async function prepareSegmentWorkspace(runtime: TaskRuntime, preTask: AgentTask | undefined, codeDiffEnabled: boolean, executor: 'sandbox' | 'local' | undefined): Promise<void> {
    const continued = !!preTask?.continuation;
    if (!codeDiffEnabled && !continued) return;
    const restored = await initWorkspaceBaseline(runtime, preTask, { forceRestore: continued });
    if (!continued || restored || executor === 'local') return;
    if (preTask?.chain_root_task_id) await new AgentTaskChainRepository(getPool()).markChainCancelled(preTask.chain_root_task_id).catch(() => { /* 표식 실패 무시 */ });
    throw new Error('이어받은 작업 공간을 복원하지 못했습니다(workspace_restore_failed) — 체인을 멈춥니다');
}
