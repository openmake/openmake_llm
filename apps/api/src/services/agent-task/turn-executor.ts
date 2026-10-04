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
import { AGENT_TASK_LIMITS } from '../../config/runtime-limits';
import { TASK_TERMINATE_SENTINEL } from '../task-sandbox/tools';
import { requiresApproval, getApprovalRegistry } from '../task-sandbox/approval-gate';
import { currentPlanStepIndex } from '../task-sandbox/planning';
import { runTool, isSearchTool } from './task-steps';
import { wrapUntrustedToolResult } from './tool-result-wrap';
import { prepareToolArgs } from './tool-args';
import { prefetchReadOnlyCalls } from '../tool-parallel';
import { notifyApprovalPending } from './approval-pending';

import { AgentTaskAbort, AgentTaskParked, AGENT_TASK_DEVICE_WAIT_REASON } from './types';
import { writeTurnCheckpoint, markToolCallInFlight } from './turn-reentry';
import { hasSideEffects } from '../../config/tool-policy';
import { priorRepetition, repetitionVerdict, cycleVerdict, rereadNote, retryAfterUnknownOutcome } from './tool-loop-guard';
import { needsReceipt, startReceipt, finishReceipt, receiptStatusOf } from './tool-receipt';
import { runWithToolCallContext } from '../../utils/tool-call-context';
import { runWithToolMediaSink, toolMediaSinkFor } from '../../utils/tool-media-sink';
import { isRejectedCall, findDuplicateCalls } from './turn-call-guards';
import { getMalformedToolArgsResult, getDuplicateToolCallResult } from '../../prompts/agent-task-turn-loop';
import { getAgentTaskUnknownOutcomeNotice, getAgentTaskUnknownOutcomeQuestion, getAgentTaskUnknownOutcomeDeclinedNotice, getAgentTaskUnknownOutcomeAnswerNotice, type UnknownOutcomeCause } from '../../prompts/agent-task-prompt';
import { getApprovalRejectedNotice } from '../../prompts/agent-task-approval';
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
    /** 작업 목표 — 도구 결과 래퍼(tool-result-wrap)가 결과 뒤에 다시 적는다. 없으면 래퍼를 쓰지 않는다. */
    goal?: string;
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
    /** 턴 중간 재개(172): 실행 도중 끊겨 결과를 알 수 없는 호출 id — 다시 실행하지 않고 안내를 결과로 기록한다. */
    unknownOutcomeId?: string;
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
    // 승인 대기 진입 콜백 — task 도구·extra 도구 공용(status='paused' + 알림). 발행 내용은 approval-pending 참고.
    const onApprovalPending = (toolName: string) => notifyApprovalPending({ userId, taskId, update, taskRuntime }, toolName);
    // 질문형 승인 만료 → 주차(F16.7): 질문 호출은 결과 없이 남겨 체크포인트하고 주차 표식 후 실행을 끝낸다.
    // 답이 오면 hitl-park 가 재개하고, turn-reentry 가 같은 호출을 다시 실행해 결정을 이어받는다(이미 끝난 호출은 저널 재사용).
    let parkRequested = false;
    // 실행 중 표식(172)을 남긴 호출인가 — 결과 스텝 뒤(또는 주차 전)에 지운다.
    let inFlightMarked = false;
    // reason 을 주면 그 사유로 표식한다(기기 대기) — 생략은 질문 응답 대기.
    const park = async (reason?: string): Promise<never> => {
        if (inFlightMarked) await markToolCallInFlight(taskId, null); // 주차된 호출은 재개 때 다시 실행된다
        await writeTurnCheckpoint(taskId, conversation, turn - 1, taskRuntime);
        await update({ status: 'paused' });
        if (reason) await new AgentTaskRepository(getPool()).markParked(taskId, reason);
        else await new AgentTaskRepository(getPool()).markParked(taskId);
        throw new AgentTaskParked(reason);
    };
    // 외부 MCP 서버의 사용자 입력 요청(F13.10) — ask_human 과 같은 채널로 묻는다(자동승인·정책 무관, 대기는 pause-aware).
    const elicitCtx: ToolUserInputContext = {
        taskId,
        ask: async (args) => {
            const r = await getApprovalRegistry().request(
                { taskId, userId, toolName: TOOL_USER_INPUT_APPROVAL_NAME, args },
                { timeoutMs: sandboxCfg.approvalTimeoutMs, signal, onPending: (p) => onApprovalPending(p.toolName), parkable: true },
            );
            pausedMs += r.waitedMs;
            if (r.reason === 'parked') { parkRequested = true; return r; } // 서버엔 cancel, 도구가 끝나면 주차
            if (r.decision === 'rejected') onApprovalRejected({ toolName: TOOL_USER_INPUT_APPROVAL_NAME, reason: r.reason ?? 'user' });
            if (getCurStatus() === 'paused') await update({ status: 'running' }).catch(() => { /* noop */ });
            return r;
        },
    };
    // 결과 불명 호출(172) — 사용자에게 묻는다: 승인 = 다시 실행(undefined), 그 밖은 다시 실행하지 않고 돌려줄 도구 결과.
    // 유예가 지나면 다른 승인처럼 주차하되 표식은 남긴다 — 재개 때 같은 질문으로 결정을 이어받는다.
    const resolveUnknownOutcome = async (name: string, toolCallId: string, cause: UnknownOutcomeCause = 'restart'): Promise<string | undefined> => {
        if (!AGENT_TASK_LIMITS.REENTRY_UNKNOWN_OUTCOME_ASK) return getAgentTaskUnknownOutcomeNotice(name);
        const r = await getApprovalRegistry().request(
            { taskId, userId, toolName: 'ask_human', args: { question: getAgentTaskUnknownOutcomeQuestion(name, cause), toolName: name, toolCallId } },
            { timeoutMs: sandboxCfg.approvalTimeoutMs, signal, onPending: (p) => onApprovalPending(p.toolName), parkable: true },
        );
        pausedMs += r.waitedMs;
        if (r.reason === 'parked') await park();
        if (getCurStatus() === 'paused') await update({ status: 'running' }).catch(() => { /* noop */ });
        if (r.decision === 'approved') return r.text?.trim() ? getAgentTaskUnknownOutcomeAnswerNotice(name, r.text.trim(), cause) : undefined;
        return r.reason === 'user' ? getAgentTaskUnknownOutcomeDeclinedNotice(name, cause) : getAgentTaskUnknownOutcomeNotice(name);
    };
    // 모델에 보이는 도구 결과 — 샌드박스 밖에서 온 결과(호스트·외부 도구)와 browser 는 데이터로 감싼다(플래그 ON·목표가 있을 때만).
    const forModel = (name: string, result: string): string =>
        AGENT_TASK_LIMITS.TOOL_RESULT_WRAP_ENABLED && input.goal && (name === 'browser' || !taskRuntime?.isTaskTool(name))
            ? wrapUntrustedToolResult(result, input.goal)
            : result;
    const execTool = (name: string, args: Record<string, unknown>): Promise<string> =>
        runWithToolMediaSink(toolMediaSinkFor(taskRuntime), () => getToolRuntime().runWithUserInputContext(elicitCtx, () => runTool(mcp, name, args, userCtx, taskRuntime?.spillLargeResult)));
    // 외부 도구(175) — 영수증을 남기고 멱등 키를 호출 문맥에 실어 실행한다(외부 MCP 클라이언트가 읽어 서버에 보낸다).
    let receiptOpen = false;
    const execWithReceipt = async (name: string, args: Record<string, unknown>, toolCallId: string | undefined): Promise<string> => {
        if (!AGENT_TASK_LIMITS.REENTRY_UNKNOWN_OUTCOME_ENABLED || toolCallId === undefined || !needsReceipt(name, args)) return execTool(name, args);
        const idempotencyKey = await startReceipt(taskId, toolCallId, name, args);
        receiptOpen = true;
        return runWithToolCallContext({ idempotencyKey }, () => execTool(name, args));
    };
    // 읽기 전용 extra 도구(web_search 등) 병렬 선실행. 승인이 필요한 호출은 **자동 승인 작업에서만**
    // 포함한다 — 아니면 승인 창이 동시에 N개 뜬다(HITL fan-in). 결과·스텝 영속은 아래 루프가
    // 원래 순서로 처리하므로 체크포인트 계약은 그대로다.
    const journal = input.journal ?? new Map<string, string>();
    // 한 응답 안의 같은 읽기 호출 — 첫 호출만 실행하고 나머지는 그 호출을 가리키는 짧은 결과로 답한다(turn-call-guards).
    const duplicateOf = findDuplicateCalls(toolCalls);
    const prefetched = await prefetchReadOnlyCalls(
        toolCalls.filter((tc) => (tc.id === undefined || !journal.has(tc.id)) && !isRejectedCall(tc) && !duplicateOf.has(tc)).map((tc) => ({ id: tc.id, name: tc.function.name, tc })),
        ({ name, tc }) => !taskRuntime?.isTaskTool(name)
            && (!requiresApproval(sandboxCfg.approvalPolicy, name, (tc.function.arguments ?? {}) as Record<string, unknown>)
                || getApprovalRegistry().autoApproves(taskId, name, (tc.function.arguments ?? {}) as Record<string, unknown>)),
        async ({ name, tc }) => {
            const args = (tc.function.arguments ?? {}) as Record<string, unknown>;
            if (extraToolNames.has(name) && requiresApproval(sandboxCfg.approvalPolicy, name, args)) {
                // 자동 승인 작업만 여기 온다 — 감사·집계를 위해 같은 레지스트리를 거친다(즉시 approved).
                const r = await getApprovalRegistry().request(
                    { taskId, userId, toolName: name, args },
                    { timeoutMs: sandboxCfg.approvalTimeoutMs, signal, policy: sandboxCfg.approvalPolicy },
                );
                pausedMs += r.waitedMs;
                if (r.decision !== 'approved') return getApprovalRejectedNotice(name, r.reason, r.text);
            }
            return execTool(name, args);
        },
        { signal, path: 'agent-task' },
    );
    for (const tc of toolCalls) {
        if (signal.aborted) throw new AgentTaskAbort('aborted');
        if (parkRequested) await park(); // 선실행(prefetch) 중 주차 — 이 턴 호출은 재개 때 다시 실행된다
        const name = tc.function.name;
        // 인자 JSON 이 깨진 호출·한 응답 안의 중복 호출 — 실행하지 않으므로 사용 도구·검색/브라우저 횟수에 세지 않는다(turn-call-guards).
        const malformed = isRejectedCall(tc);
        const original = duplicateOf.get(tc);
        if (!malformed && !original) {
            usedTools.add(name);
            if (isSearchTool(name)) searchCalls++;
            if (name === 'browser') browserCalls++;
        }
        const args = (tc.function.arguments ?? {}) as Record<string, unknown>;
        let toolResult: string;
        // 기기 대기(P1-4) — 이 호출의 결과를 기록한 뒤 주차한다(쓰기·실행을 보낸 뒤 끊겨 결과 불명).
        let parkForDeviceAfterRecord = false;
        inFlightMarked = false;
        receiptOpen = false;
        // 부작용 도구는 승인 뒤·실행 직전에 표식을 남긴다 — 재개 때 저널에 없으면 결과 불명(다시 실행하지 않음).
        const beforeExecute = AGENT_TASK_LIMITS.REENTRY_UNKNOWN_OUTCOME_ENABLED && tc.id !== undefined && hasSideEffects(name, args)
            ? async (): Promise<void> => { inFlightMarked = true; await markToolCallInFlight(taskId, tc.id!); }
            : undefined;
        const journaled = tc.id !== undefined ? journal.get(tc.id) : undefined;
        const pre = tc.id !== undefined ? prefetched.get(tc.id) : undefined;
        // 기기와 끊겨 결과 불명으로 끝난 쓰기를 다시 하려 하는가 — 두 번 나가지 않게 사용자에게 묻고(승인하면 다시 실행),
        // 이미 다시 실행하지 않기로 한 쓰기는 묻지 않고 막는다.
        const deviceRetry = journaled === undefined && tc.id !== undefined && !malformed && hasSideEffects(name, args)
            ? retryAfterUnknownOutcome(conversation, name, args) : null;
        const unknownResult = journaled === undefined && tc.id !== undefined && tc.id === input.unknownOutcomeId
            ? await resolveUnknownOutcome(name, tc.id)
            : deviceRetry === 'ask' ? await resolveUnknownOutcome(name, tc.id!, 'device')
                : deviceRetry === 'declined' ? getAgentTaskUnknownOutcomeDeclinedNotice(name, 'device') : undefined;
        // 반복 가드 — 같은 호출의 연속 실패·같은 결과 반복을 대화에서 세어 안내하거나 실행하지 않는다(tool-loop-guard).
        const loop = AGENT_TASK_LIMITS.TOOL_LOOP_GUARD_ENABLED && journaled === undefined && unknownResult === undefined && !original
            ? repetitionVerdict(priorRepetition(conversation, name, args), { readOnly: !hasSideEffects(name, args), toolName: name }, {
                warnFailures: AGENT_TASK_LIMITS.TOOL_LOOP_WARN_FAILURES, blockFailures: AGENT_TASK_LIMITS.TOOL_LOOP_BLOCK_FAILURES,
                warnSameResult: AGENT_TASK_LIMITS.TOOL_LOOP_WARN_SAME_RESULT, blockSameResult: AGENT_TASK_LIMITS.TOOL_LOOP_BLOCK_SAME_RESULT,
            })
            : undefined;
        // 주기 반복(A-B-A-B) — 서로 다른 호출이 같은 결과로 번갈아 되풀이되면 같은 두 단계로 다룬다.
        const cycle = loop ? cycleVerdict(conversation, name, args) : undefined;
        if (journaled !== undefined) {
            // 저널 재사용(124) — 결과는 이미 스텝에 있으므로 대화에만 싣고 스텝·체크포인트는 건너뛴다.
            conversation.push({ role: 'tool', content: forModel(name, journaled), tool_name: name, tool_call_id: tc.id });
            continue;
        } else if (unknownResult !== undefined) {
            toolResult = unknownResult;
            inFlightMarked = true; // 남아 있는 표식을 아래에서 지운다
        } else if (malformed) {
            toolResult = getMalformedToolArgsResult(name);
        } else if (original) {
            toolResult = getDuplicateToolCallResult(name, original.id);
        } else if (loop?.block) {
            toolResult = loop.blockedResult;
        } else if (cycle?.block) {
            toolResult = cycle.blockedResult;
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
                onBeforeExecute: beforeExecute,
            }).catch((e: unknown) => (e instanceof AgentTaskParked ? park() : Promise.reject(e)));
            // 로컬 기기가 사라졌다 — 닿지 않은 호출은 결과 없이 주차(재개 때 다시 실행), 결과 불명은 안내를 남기고 주차.
            const deviceLoss = taskRuntime.consumeDeviceLoss?.() ?? null;
            if (deviceLoss === 'rerunnable') await park(AGENT_TASK_DEVICE_WAIT_REASON);
            parkForDeviceAfterRecord = deviceLoss === 'unknown';
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
            let rejectText: string | undefined;
            if (requiresApproval(sandboxCfg.approvalPolicy, name, args)) {
                const r = await getApprovalRegistry().request(
                    { taskId, userId, toolName: name, args },
                    { timeoutMs: sandboxCfg.approvalTimeoutMs, signal, onPending: (p) => onApprovalPending(p.toolName), parkable: true, policy: sandboxCfg.approvalPolicy },
                );
                decision = r.decision;
                rejectReason = r.reason;
                rejectText = r.text;
                pausedMs += r.waitedMs; // 4-1 pause-aware
                if (rejectReason === 'parked') await park(); // 유예 초과 → 주차: 실행 전이라 결과 없이 체크포인트, 재개 때 결정 이어받음
                if (decision === 'rejected') onApprovalRejected({ toolName: name, reason: rejectReason ?? 'user' });
            }
            if (getCurStatus() === 'paused') await update({ status: 'running' }).catch(() => { /* noop */ });
            if (decision === 'approved') await beforeExecute?.();
            toolResult = decision === 'approved'
                ? await execWithReceipt(name, args, tc.id)
                : getApprovalRejectedNotice(name, rejectReason, rejectText);
        } else {
            await beforeExecute?.();
            toolResult = await execWithReceipt(name, args, tc.id);
        }
        if (parkRequested) await park(); // mcp_elicit 주차 — 결과(cancel 응답)는 기록하지 않는다
        if (loop && !loop.block && !cycle?.block) toolResult += loop.noteFor(toolResult) || cycle!.noteFor(forModel(name, toolResult)) || rereadNote(conversation, name, args, toolResult);
        conversation.push({
            role: 'tool',
            content: forModel(name, toolResult),
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
        // 영수증 종료(175) — 실행했으면 결과대로, 결과 불명인데 다시 실행하지 않았으면 outcome_unknown 으로 닫는다.
        if (receiptOpen) await finishReceipt(taskId, tc.id!, receiptStatusOf(toolResult));
        else if (unknownResult !== undefined && needsReceipt(name, args)) await finishReceipt(taskId, tc.id!, 'outcome_unknown');
        if (inFlightMarked) await markToolCallInFlight(taskId, null);
        emitStep('tool_result', name, toolResult);
        // 턴 중간 체크포인트(6-4, opt-in): 도구 결과 단위로 저장 — 이 시점 conversation 은
        // assistant(tool_calls)+실행된 tool 결과들로 유효하며, resume 이 같은 턴(fromTurn=turn)
        // 에서 LLM 호출로 자연 이어져 이미 실행된 도구(특히 write)를 재실행하지 않는다.
        if (AGENT_TASK_LIMITS.MIDTURN_CHECKPOINT_ENABLED) {
            await db.updateAgentTask(taskId, {
                checkpoint: { conversation, completedTurn: turn - 1 },
            }).catch(() => { /* checkpoint 실패는 실행을 막지 않음 */ });
        }
        if (parkForDeviceAfterRecord) await park(AGENT_TASK_DEVICE_WAIT_REASON);
    }

    return { terminated, terminateSummary, stepNumber, searchCalls, browserCalls, pausedMs, approvalTimeouts };
}
