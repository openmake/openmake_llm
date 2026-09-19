/**
 * Agent Task 한 턴의 도구 호출 실행 루프 — AgentTaskService 에서 분리 (파일 크기 가드).
 *
 * task 도구(영속 샌드박스)·extra(화이트리스트 호스트) 도구·일반 MCP 도구를 승인 게이트와 함께
 * 실행하고, 각 결과를 conversation·스텝(DB)·WS 로 반영한다. terminate 시그널을 감지해 호출부에
 * 완료 처리를 위임한다. 카운터(step/search/browser/paused)는 값으로 넘겨받아 갱신값을 반환한다.
 *
 * @module services/agent-task/turn-executor
 */
import { getUnifiedDatabase, getPool } from '../../data/models/unified-database';
import { getToolRuntime, TOOL_USER_INPUT_APPROVAL_NAME, type ToolRuntime, type ToolUserInputContext } from '../../runtime-ports/tool-runtime';
import { getPushService } from '../PushService';
import { AGENT_TASK_LIMITS } from '../../config/runtime-limits';
import { TASK_TERMINATE_SENTINEL } from '../task-sandbox/tools';
import { requiresApproval, getApprovalRegistry } from '../task-sandbox/approval-gate';
import { currentPlanStepIndex } from '../task-sandbox/planning';
import { runTool, isSearchTool } from './task-steps';
import { prepareToolArgs } from './tool-args';
import { prefetchReadOnlyCalls } from '../tool-parallel';

import { AgentTaskAbort, AgentTaskParked } from './types';
import { writeTurnCheckpoint } from './turn-reentry';
import { AgentTaskRepository } from '../../data/repositories/agent-task-repository';
import type { TaskRuntime } from '../task-sandbox/runtime';
import type { TaskSandboxConfig } from '../../config/task-sandbox';
import type { UserContext } from '../../tool-contract/types';
import type { ChatMessage, ToolCall } from '../../llm/types';

type UnifiedDb = ReturnType<typeof getUnifiedDatabase>;
type AgentTaskUpdatePayload = Parameters<UnifiedDb['updateAgentTask']>[1];

interface TurnToolExecInput {
    /** 이 턴에서 모델이 요청한 도구 호출 (recoverTextToolCalls 승격분 포함). */
    toolCalls: ToolCall[];
    taskRuntime: TaskRuntime | null;
    sandboxCfg: TaskSandboxConfig;
    /** 샌드박스 밖 호스트에서 실행되는 화이트리스트 도구 이름. */
    extraToolNames: Set<string>;
    mcp: ToolRuntime;
    userCtx: UserContext;
    userId: string;
    taskId: string;
    turn: number;
    conversation: ChatMessage[];
    /** 실제 사용한 도구 추적 (goal judge 실행 컨텍스트) — 제자리 갱신. */
    usedTools: Set<string>;
    signal: AbortSignal;
    stepNumber: number;
    searchCalls: number;
    browserCalls: number;
    pausedMs: number;
    /** 승인 무응답(timeout) 누적 횟수 — HITL 강등 판단(호출부). */
    approvalTimeouts: number;
    /** 상태 전이(paused↔running) 판단용 — 최신 curStatus 를 읽는다. */
    getCurStatus: () => string;
    update: (u: AgentTaskUpdatePayload) => Promise<void>;
    emitStep: (stepType: string, toolName?: string, content?: string | null) => void;
    /** 턴 중간 재개(124): tool_call_id → 이미 실행된 결과. 있는 호출은 재실행하지 않고 결과만 대화에 싣는다. */
    journal?: Map<string, string>;
}

interface TurnToolExecResult {
    /** terminate 도구 호출로 깔끔한 완료 시그널이 왔는지. */
    terminated: boolean;
    terminateSummary: string;
    stepNumber: number;
    searchCalls: number;
    browserCalls: number;
    pausedMs: number;
    approvalTimeouts: number;
}

/**
 * 한 턴의 도구 호출을 순차 실행한다. conversation·usedTools 는 제자리 갱신하고,
 * 카운터/terminate 상태는 반환값으로 넘긴다.
 */
export async function executeTurnToolCalls(input: TurnToolExecInput): Promise<TurnToolExecResult> {
    const {
        toolCalls, taskRuntime, sandboxCfg, extraToolNames, mcp, userCtx, userId, taskId,
        turn, conversation, usedTools, signal, getCurStatus, update, emitStep,
    } = input;
    const db = getUnifiedDatabase();
    let { stepNumber, searchCalls, browserCalls, pausedMs, approvalTimeouts } = input;
    // 승인 무응답 카운트 — task 도구(runtime 내부 게이트)·extra 도구(아래 명시 게이트) 공용.
    const onApprovalRejected = (info: { toolName: string; reason: string }): void => {
        if (info.reason === 'timeout') approvalTimeouts++;
    };

    // 도구 실행 + 체크포인트
    let terminated = false;
    let terminateSummary = '';
    // 승인 대기 진입 콜백 — task 도구·extra 도구 공용(status='paused' + 알림).
    // 알림은 두 채널: 웹 푸시(설정에서 켠 사용자만 — 운영 구독 0건이던 opt-in) + 로컬 실행 작업이면
    // 실행 디바이스(컴패니언 네이티브 알림, 2026-09-11). 링크는 작업 상세로 바로 연다.
    const onApprovalPending = (toolName: string) => {
        void update({ status: 'paused' }).catch(() => { /* noop */ });
        void getPushService().sendPush(userId, {
            title: 'OpenMake 에이전트 — 승인 필요',
            body: `도구 실행 승인을 기다립니다: ${toolName}`,
            url: `/agent-tasks?task=${encodeURIComponent(taskId)}`,
        }).catch(() => { /* noop */ });
        try { taskRuntime?.notifyApprovalPending(toolName); } catch { /* 알림 실패는 작업에 영향 없음 */ }
    };
    // 질문형 승인 만료 → 주차(F16.7): 질문 호출은 결과 없이 남겨 체크포인트하고 주차 표식 후 실행을 끝낸다.
    // 답이 오면 hitl-park 가 재개하고, turn-reentry 가 같은 호출을 다시 실행해 결정을 이어받는다(이미 끝난 호출은 저널 재사용).
    let parkRequested = false;
    const park = async (): Promise<never> => {
        await writeTurnCheckpoint(taskId, conversation, turn - 1, taskRuntime);
        await update({ status: 'paused' });
        await new AgentTaskRepository(getPool()).markParked(taskId);
        throw new AgentTaskParked();
    };
    // 외부 MCP 서버의 사용자 입력 요청(F13.10) — ask_human 과 같은 채널로 묻는다(자동승인·정책 무관, 대기는 pause-aware).
    const elicitCtx: ToolUserInputContext = {
        taskId,
        ask: async (args) => {
            const r = await getApprovalRegistry().request(
                { taskId, userId, toolName: TOOL_USER_INPUT_APPROVAL_NAME, args },
                { timeoutMs: sandboxCfg.approvalTimeoutMs, signal, onPending: (p) => onApprovalPending(p.toolName) },
            );
            pausedMs += r.waitedMs;
            if (r.reason === 'parked') { parkRequested = true; return r; } // 서버엔 cancel, 도구가 끝나면 주차
            if (r.decision === 'rejected') onApprovalRejected({ toolName: TOOL_USER_INPUT_APPROVAL_NAME, reason: r.reason ?? 'user' });
            if (getCurStatus() === 'paused') await update({ status: 'running' }).catch(() => { /* noop */ });
            return r;
        },
    };
    const execTool = (name: string, args: Record<string, unknown>): Promise<string> =>
        getToolRuntime().runWithUserInputContext(elicitCtx, () => runTool(mcp, name, args, userCtx));
    // 읽기 전용 extra 도구(web_search 등) 병렬 선실행. 승인이 필요한 호출은 **자동 승인 작업에서만**
    // 포함한다 — 아니면 승인 창이 동시에 N개 뜬다(HITL fan-in). 결과·스텝 영속은 아래 루프가
    // 원래 순서로 처리하므로 체크포인트 계약은 그대로다.
    const journal = input.journal ?? new Map<string, string>();
    const prefetched = await prefetchReadOnlyCalls(
        toolCalls.filter((tc) => tc.id === undefined || !journal.has(tc.id)).map((tc) => ({ id: tc.id, name: tc.function.name, tc })),
        ({ name, tc }) => !taskRuntime?.isTaskTool(name)
            && (!requiresApproval(sandboxCfg.approvalPolicy, name, (tc.function.arguments ?? {}) as Record<string, unknown>)
                || getApprovalRegistry().isAutoApprove(taskId)),
        async ({ name, tc }) => {
            const args = (tc.function.arguments ?? {}) as Record<string, unknown>;
            if (extraToolNames.has(name) && requiresApproval(sandboxCfg.approvalPolicy, name, args)) {
                // 자동 승인 작업만 여기 온다 — 감사·집계를 위해 같은 레지스트리를 거친다(즉시 approved).
                const r = await getApprovalRegistry().request(
                    { taskId, userId, toolName: name, args },
                    { timeoutMs: sandboxCfg.approvalTimeoutMs, signal },
                );
                pausedMs += r.waitedMs;
                if (r.decision !== 'approved') return `Error: 사용자가 도구 실행을 승인하지 않았습니다 (${name}).`;
            }
            return execTool(name, args);
        },
        { signal, path: 'agent-task' },
    );
    for (const tc of toolCalls) {
        if (signal.aborted) throw new AgentTaskAbort('aborted');
        if (parkRequested) await park(); // 선실행(prefetch) 중 주차 — 이 턴 호출은 재개 때 다시 실행된다
        const name = tc.function.name;
        usedTools.add(name);
        if (isSearchTool(name)) searchCalls++;
        if (name === 'browser') browserCalls++;
        const args = (tc.function.arguments ?? {}) as Record<string, unknown>;
        let toolResult: string;
        const journaled = tc.id !== undefined ? journal.get(tc.id) : undefined;
        const pre = tc.id !== undefined ? prefetched.get(tc.id) : undefined;
        if (journaled !== undefined) {
            // 저널 재사용(124) — 결과는 이미 스텝에 있으므로 대화에만 싣고 스텝·체크포인트는 건너뛴다.
            conversation.push({ role: 'tool', content: journaled, tool_name: name, tool_call_id: tc.id });
            continue;
        } else if (pre !== undefined) {
            toolResult = pre;
        } else if (taskRuntime?.isTaskTool(name)) {
            // task 도구 — 승인 게이트 통과 후 영속 샌드박스에서 실행.
            // onApprovalWaited: 승인 대기 시간을 pausedMs 로 누적(4-1 pause-aware 타임아웃).
            toolResult = await taskRuntime.executeTaskTool(name, args, {
                signal,
                onApprovalPending: (p) => onApprovalPending(p.toolName),
                onApprovalWaited: (ms) => { pausedMs += ms; },
                onApprovalRejected,
            }).catch((e: unknown) => (e instanceof AgentTaskParked ? park() : Promise.reject(e)));
            if (getCurStatus() === 'paused') await update({ status: 'running' }).catch(() => { /* noop */ });
            if (toolResult.includes(TASK_TERMINATE_SENTINEL)) {
                terminated = true;
                terminateSummary = String(args.summary ?? '');
            }
        } else if (extraToolNames.has(name)) {
            // extra(화이트리스트) 도구 — 샌드박스 밖 호스트에서 실행되지만 HITL 승인은 task 도구와 동일 적용.
            // (이 도구들은 격리 컨테이너가 아니라 API 프로세스에서 실행되므로 승인 우회를 닫는다.)
            // extraToolNames 는 샌드박스 ENABLED(활성·degrade) 일 때만 채워지므로 legacy OFF 경로엔 영향 없음.
            let decision: 'approved' | 'rejected' = 'approved';
            let rejectReason: string | undefined;
            if (requiresApproval(sandboxCfg.approvalPolicy, name, args)) {
                const r = await getApprovalRegistry().request(
                    { taskId, userId, toolName: name, args },
                    { timeoutMs: sandboxCfg.approvalTimeoutMs, signal, onPending: (p) => onApprovalPending(p.toolName) },
                );
                decision = r.decision;
                rejectReason = r.reason;
                pausedMs += r.waitedMs; // 4-1 pause-aware
                if (decision === 'rejected') onApprovalRejected({ toolName: name, reason: rejectReason ?? 'user' });
            }
            if (getCurStatus() === 'paused') await update({ status: 'running' }).catch(() => { /* noop */ });
            toolResult = decision === 'approved'
                ? await execTool(name, args)
                : rejectReason === 'timeout'
                    ? `Error: 승인 대기 시간이 초과되었습니다(무응답, ${name}). 사용자가 자리를 비운 것으로 보입니다 — 승인이 필요 없는 방법으로 진행하거나, 지금까지 확보한 결과로 최종 산출물을 작성하세요.`
                    : `Error: 사용자가 도구 실행을 승인하지 않았습니다 (${name}). 다른 방법을 시도하거나 작업을 종료하세요.`;
        } else {
            toolResult = await execTool(name, args);
        }
        if (parkRequested) await park(); // mcp_elicit 주차 — 결과(cancel 응답)는 기록하지 않는다
        conversation.push({
            role: 'tool',
            content: toolResult,
            tool_name: name,
            tool_call_id: tc.id,
        });
        await db.addAgentTaskStep({
            taskId,
            stepNumber: stepNumber++,
            stepType: 'tool_result',
            toolName: name,
            content: toolResult,
            // 스텝→플랜 노드 귀속(088) — plan_update 직후엔 갱신된 스냅샷 기준(새 단계로 귀속).
            planStepIndex: taskRuntime ? currentPlanStepIndex(taskRuntime.getPlanSnapshot()) : undefined,
            // 호출 인자 영속(091) — 마스킹·크기 캡은 prepareToolArgs 가 담당(사후 원인 분석).
            toolArgs: prepareToolArgs(args),
            // 도구 호출 저널(124) — 재개 시 이 id 가 있는 호출은 재실행하지 않는다.
            toolCallId: tc.id,
        });
        emitStep('tool_result', name, toolResult);
        // 턴 중간 체크포인트(6-4, opt-in): 도구 결과 단위로 저장 — 이 시점 conversation 은
        // assistant(tool_calls)+실행된 tool 결과들로 유효하며, resume 이 같은 턴(fromTurn=turn)
        // 에서 LLM 호출로 자연 이어져 이미 실행된 도구(특히 write)를 재실행하지 않는다.
        if (AGENT_TASK_LIMITS.MIDTURN_CHECKPOINT_ENABLED) {
            await db.updateAgentTask(taskId, {
                checkpoint: { conversation, completedTurn: turn - 1 },
            }).catch(() => { /* checkpoint 실패는 실행을 막지 않음 */ });
        }
    }

    return { terminated, terminateSummary, stepNumber, searchCalls, browserCalls, pausedMs, approvalTimeouts };
}
