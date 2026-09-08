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
import { chatTurnWithRoleFallback, type AgentRoleState } from './role-client';
import { AgentTaskAbort } from './types';
import type { ChatMessage, ToolDefinition } from '../../llm/types';

/** 시간 예산으로 끊긴 턴 — 마무리 턴이었으면 스트리밍으로 받은 부분 본문을 함께 전달. */
export class AgentTaskTurnTimeout extends AgentTaskAbort {
    constructor(public readonly partialContent: string | null) {
        super('timeout');
        this.name = 'AgentTaskTurnTimeout';
    }
}

export interface TurnCallInput {
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
    onRetry?: (info: { attempt: number; maxAttempts: number; error: string }) => void;
}

/**
 * 잔여 예산을 이 호출에 바인딩해 hang 을 끊는다(턴 사이 assertWithinLimits 까지 못 가는 경우 대비).
 * 마무리 턴은 도구 없이 장문을 생성하므로 잔여와 무관하게 FINAL_TURN_MIN_MS 를 보장하고, 그 턴만
 * 스트리밍해(도구 턴은 종전대로 비스트림) 예산 abort 시 부분 본문을 AgentTaskTurnTimeout 에 실어 던진다.
 */
export interface TurnCallResult {
    result: Awaited<ReturnType<typeof chatTurnWithRoleFallback>>;
    /** 이 턴의 예산 바인딩 signal — 뒤따르는 finalize(judge·검증)도 같은 예산에 묶는다. */
    callSignal: AbortSignal;
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
            taskId: p.taskId, userId: p.userId, onToken, onRetry: p.onRetry,
        });
        return { result, callSignal };
    } catch (err) {
        if (callTimeout.aborted && !p.signal.aborted) {
            throw new AgentTaskTurnTimeout(partialContent.trim() || null);
        }
        throw err;
    }
}
