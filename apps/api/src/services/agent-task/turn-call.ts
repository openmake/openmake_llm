/**
 * Agent Task 턴 LLM 호출 — 시간 예산 바인딩·마무리 턴 최소 보장·부분 본문 보존
 * (AgentTaskService 에서 분리 — 파일 크기 가드).
 *
 * 근거(2026-09-09 실측, 작업 10770ab5): 25턴 동안 같은 파일을 반복해 읽다 토큰 소프트 상한으로
 * 마무리 턴에 들어갔는데, 총 시간 예산(10분)의 잔여가 2분뿐이라 per-call 예산 signal 이 보고서 생성
 * 도중 호출을 끊었다. 그 결과 ① error 가 SDK 의 임의 문구("Request was aborted.")로 남아 timeout 과
 * 구분되지 않았고 ② 스트리밍 중이던 본문은 버려져 result NULL 이었다. 2회 실행 모두 같은 지점 실패.
 *
 * @module services/agent-task/turn-call
 */
import { AGENT_TASK_LIMITS } from '../../config/runtime-limits';
import { chatTurnWithRoleFallback, TurnCallCapExceeded, type AgentRoleState } from './role-client';
import { AgentTaskAbort } from './types';
import { AGENT_TASK_TURN_LOOP } from '../../config/agent-task-turn-loop';
import { detectOutputRepetition, cutRepeatedOutput, goalRequestsRepetition } from './output-repetition';
import { recoverTextToolCalls } from './text-tool-calls';
import { getContextTrimNote, getTransientRetryNote, getOutputRepetitionNote } from '../../prompts/agent-task-turn-loop';
import type { ChatMessage, ToolDefinition } from '../../llm/types';

/** 시간 예산으로 끊긴 턴 — 마무리 턴이었으면 스트리밍으로 받은 부분 본문을 함께 전달. */
export class AgentTaskTurnTimeout extends AgentTaskAbort {
    constructor(public readonly partialContent: string | null) {
        super('timeout');
        this.name = 'AgentTaskTurnTimeout';
    }
}

/** 시간 예산으로 끊긴 마무리 턴의 부분 본문을 작업 결과로 남기는 갱신 조각 — 해당 없으면 빈 객체(종전엔 result NULL). */
export function partialResultOf(err: unknown): { result?: string } {
    return err instanceof AgentTaskTurnTimeout && err.partialContent
        ? { result: `[시간 예산 초과로 중단된 부분 답변]\n\n${err.partialContent}` } : {};
}

interface TurnCallInput {
    roleState: AgentRoleState;
    conversation: ChatMessage[];
    tools: ToolDefinition[];
    /** 작업 전체 abort(사용자 취소) signal. */
    signal: AbortSignal;
    taskId: string;
    userId: string;
    /** 총 시간 예산(ms)과 지금까지의 활성 경과(승인 대기 제외). */
    totalTimeoutMs: number;
    elapsedActiveMs: number;
    /** 마무리 턴 여부 — 최소 시간 보장 + 스트리밍 부분 본문 보존이 켜진다. */
    finalTurn: boolean;
    /** 이 호출에서 생긴 일을 단계 기록으로 남기는 훅(stepType, 본문) — 일시적 오류 재시도·컨텍스트 절단·출력 반복. 동기 호출, 실패해도 호출을 막지 않을 것. */
    onNote?: (stepType: string, note: string) => void;
}

/**
 * 잔여 예산을 이 호출에 바인딩해 hang 을 끊는다(턴 사이 assertWithinLimits 까지 못 가는 경우 대비).
 * 마무리 턴은 도구 없이 장문을 생성하므로 잔여와 무관하게 FINAL_TURN_MIN_MS 를 보장하고, 그 턴만
 * 스트리밍해(도구 턴은 종전대로 비스트림) 예산 abort 시 부분 본문을 AgentTaskTurnTimeout 에 실어 던진다.
 */
interface TurnCallResult {
    result: Awaited<ReturnType<typeof chatTurnWithRoleFallback>>;
    /** 이 턴의 예산 바인딩 signal — 뒤따르는 finalize(judge·검증)도 같은 예산에 묶는다. */
    callSignal: AbortSignal;
    /** 본문을 출력 반복 때문에 잘랐는가 — 최종 답이 될 응답이면 turn-context 가 한 번 다시 요청한다. */
    repetitionCut?: boolean;
}

export async function callAgentTurnWithBudget(p: TurnCallInput): Promise<TurnCallResult> {
    const remainingMs = Math.max(
        p.finalTurn ? AGENT_TASK_LIMITS.FINAL_TURN_MIN_MS : 1_000,
        p.totalTimeoutMs - p.elapsedActiveMs,
    );
    const callTimeout = AbortSignal.timeout(remainingMs);
    const callSignal = AbortSignal.any([p.signal, callTimeout]);
    let partialContent = '';
    const onToken = p.finalTurn ? (t: string) => { partialContent += t; } : undefined;
    try {
        const result = await chatTurnWithRoleFallback(p.roleState, {
            conversation: p.conversation, tools: p.tools, signal: callSignal,
            taskId: p.taskId, userId: p.userId, onToken,
            // 도구 턴만 호출당 상한을 건다 — 마무리 턴은 장문 생성이라 위의 최소 보장을 따른다.
            callTimeoutMs: p.finalTurn ? undefined : AGENT_TASK_LIMITS.TURN_CALL_TIMEOUT_MS,
            // 도구 턴은 청크가 끊긴 호출을 상한 전에 끊는다(무응답 감시) — 0 이면 끔.
            idle: p.finalTurn || AGENT_TASK_LIMITS.TURN_STREAM_IDLE_MS <= 0 ? undefined
                : { firstChunkMs: AGENT_TASK_LIMITS.TURN_STREAM_FIRST_CHUNK_MS, gapMs: AGENT_TASK_LIMITS.TURN_STREAM_IDLE_MS },
            // 짧은 재시도가 소진된 일시적 오류는 이 호출의 남은 예산 안에서 더 기다린다(turn-recovery).
            recoveryBudgetMs: remainingMs,
            // 재시도는 처음부터 다시 받는다 — 끊긴 시도의 부분 본문을 버려 겹치지 않게 한다.
            onRetry: (info) => { partialContent = ''; p.onNote?.('retry', getTransientRetryNote(info.attempt, info.maxAttempts, info.error)); },
        });
        // 창 초과로 요청 사본에서 오래된 메시지가 잘렸으면 단계 기록으로 남긴다 — 종전엔 로그 한 줄뿐이었다.
        const dropped = result.metrics?.context_dropped_messages ?? 0;
        if (dropped > 0 && AGENT_TASK_TURN_LOOP.CONTEXT_TRIM_STEP_ENABLED) {
            try { p.onNote?.('context_trim', getContextTrimNote(dropped, p.conversation.length)); } catch { /* 관측 실패 무시 */ }
        }
        // 본문의 구간 반복(모델 반복 루프의 흔적) — 기록하고, 반복이 시작된 뒤를 잘라 낸다(모델이 자기 반복을 다시 읽고 이어가지 않게).
        // 도구 호출은 건드리지 않는다. 본문 자체가 텍스트 도구 호출이면 자르지 않는다(호출문이 깨진다).
        const { OUTPUT_REPETITION_STEP_ENABLED: noteOn, OUTPUT_REPETITION_CUT_ENABLED: cutOn } = AGENT_TASK_TURN_LOOP;
        const repetition = noteOn || cutOn ? detectOutputRepetition(result.content) : null;
        // 사용자가 일부러 반복 출력을 시킨 작업이면 자르지 않는다(기록은 남긴다).
        const repetitionCut = !!repetition && cutOn && recoverTextToolCalls(result.content ?? '').length === 0 && !goalRequestsRepetition(p.conversation);
        if (repetition && noteOn) {
            try { p.onNote?.('output_repetition', getOutputRepetitionNote(repetition.repeats, AGENT_TASK_TURN_LOOP.OUTPUT_REPETITION_WINDOW_CHARS, repetition.sample, repetitionCut)); } catch { /* 관측 실패 무시 */ }
        }
        if (repetition && repetitionCut) result.content = cutRepeatedOutput(result.content ?? '', repetition.cutAt);
        return { result, callSignal, repetitionCut };
    } catch (err) {
        if ((callTimeout.aborted && !p.signal.aborted) || err instanceof TurnCallCapExceeded) {
            throw new AgentTaskTurnTimeout(partialContent.trim() || null);
        }
        throw err;
    }
}
