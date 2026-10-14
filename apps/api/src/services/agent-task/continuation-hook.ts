/**
 * 실행 루프(AgentTaskService)와 이어가기(continuation)를 잇는 얇은 층 — 서비스 파일의 줄 수를 지키기 위해 분리.
 * @module services/agent-task/continuation-hook
 */
import { getUnifiedDatabase, getPool } from '../../data/models/unified-database';
import type { AgentTask } from '../../data/models/unified-database.types';
import { AgentTaskChainRepository } from '../../data/repositories/agent-task-chain-repository';
import type { ChatMessage, ToolDefinition } from '../../llm/types';
import type { TaskRuntime } from '../task-sandbox/runtime';
import { initWorkspaceBaseline } from './code-diff';
import { chainBudgetState, continueAsNewSegment, type ContinueInput } from './continuation';
import { contextUsageRatio } from './turn-context';
import type { TurnGateFlags } from './turn-gate';

export interface ChainContext { task: AgentTask; root: AgentTask }

/** 체인 작업이면 현재 행과 루트 행. 루트 자신이면 둘이 같다. 이미 읽은 행(preloaded)을 넘기면 체인이 아닐 때 DB 를 다시 읽지 않는다. */
export async function loadChainContext(taskId: string, preloaded?: AgentTask): Promise<ChainContext | null> {
    const db = getUnifiedDatabase();
    const task = preloaded ?? await db.getAgentTask(taskId);
    if (!task?.chain_root_task_id) return null;
    const root = task.chain_root_task_id === task.id ? task : await db.getAgentTask(task.chain_root_task_id);
    return root?.long_running ? { task, root } : null;
}

/** turn-gate 의 chain 입력 — 체인이 아니면 undefined(게이트는 종전과 같다). */
export function chainGateInput(ctx: ChainContext | null, conversation: ChatMessage[], tools: ToolDefinition[], model: string, activeMs: number, totalTokens: number): { canContinue: boolean; contextRatio: number | null } | undefined {
    if (!ctx) return undefined;
    const state = chainBudgetState(ctx.task, ctx.root, activeMs, totalTokens);
    if (!state) return undefined;
    return { canContinue: state.canContinue, contextRatio: contextUsageRatio(conversation, tools, model) };
}

type FinishInput = Omit<ContinueInput, 'task' | 'root'> & { ctx: ChainContext; update: (u: { status: 'completed'; completionPath: string; result: string; progress: number }) => Promise<void> };

/** 후속을 만들고 현재 작업을 '이어짐' 으로 마감. 실패면 false — 호출부가 종전 마무리 턴으로 간다. */
export async function finishAsContinued(p: FinishInput): Promise<boolean> {
    const outcome = await continueAsNewSegment({ ...p, task: p.ctx.task, root: p.ctx.root });
    if ('skipped' in outcome) return false;
    await p.update({ status: 'completed', completionPath: 'continued', progress: 100, result: `이어가기: 후속 작업 ${outcome.successorId} 에서 계속합니다 (사유: ${p.reason}).` });
    return true;
}

/** 서비스 루프의 호출 한 줄 — 이어졌으면 true(루프 종료). 실패면 다음 턴에 종전 마무리 nudge 가 들어가게 플래그를 되돌린다. */
export async function tryContinue(p: FinishInput & { gateFlags: TurnGateFlags }): Promise<boolean> {
    if (await finishAsContinued(p)) return true;
    p.gateFlags.finalTurnNotified = false;
    return false;
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
