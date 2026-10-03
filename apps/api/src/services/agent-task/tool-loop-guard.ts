/**
 * 도구 호출 반복 가드 — 같은 호출이 연속으로 실패하거나 같은 결과만 돌려줄 때 안내하고, 임계를 넘으면 실행하지 않는다.
 *
 * 종전의 반복 감지(turn-guards.pushStuckSignature)는 응답 전체(본문 + 호출)가 완전히 같을 때만 걸려,
 * 본문이 조금만 달라도 같은 실패 호출을 되풀이하며 턴을 태웠다. 여기서는 호출 단위로 본다.
 *
 * 상태를 따로 들고 다니지 않고 대화에서 센다 — 재개(체크포인트 복원) 뒤에도 그대로 동작한다.
 * 모두 결정적 규칙이다(LLM 호출 없음).
 *
 * @module services/agent-task/tool-loop-guard
 */
import type { ChatMessage } from '../../llm/types';
import { hashApprovalArgs } from '../../data/repositories/agent-task-approval-repository';
import { getToolLoopBlockedResult, getToolLoopFailureNote, getToolLoopSameResultNote } from '../../prompts/agent-task-prompt';
import { DUPLICATE_TOOL_CALL_PREFIX } from '../../prompts/agent-task-turn-loop';

interface PriorRepetition {
    /** 직전까지 같은 이름·인자로 연속 실패한 횟수. */
    failures: number;
    /** 직전까지 같은 이름·인자가 같은 결과를 돌려준 연속 횟수(실패 제외). */
    sameResult: number;
    /** 그 같은 결과의 본문(이번 결과와 비교용). */
    lastResult?: string;
}

interface LoopLimits {
    warnFailures: number;
    blockFailures: number;
    warnSameResult: number;
    blockSameResult: number;
}

/** PURE: 결과가 실패인가 — 데이터 래퍼(<tool_output>)에 싸여 있어도 본다. */
function isErrorResult(content: string): boolean {
    return /^(?:<tool_output>\s*)?Error:/.test(content);
}

/** 중복 호출 안내 결과 — 데이터 래퍼(<tool_output>)에 싸여 있어도 본다. */
const DUPLICATE_TOOL_CALL_RE = new RegExp(`^(?:<tool_output>\\s*)?${DUPLICATE_TOOL_CALL_PREFIX.replace(/[[\]]/g, '\\$&')}`);

const signature = (name: string, args: unknown): string => `${name}:${hashApprovalArgs((args ?? {}) as Record<string, unknown>)}`;

/**
 * PURE: 대화의 끝에서부터, 지금 하려는 호출(name, args)과 같은 호출이 연속으로 몇 번 있었는지 센다.
 * 다른 호출이 하나라도 끼면 거기서 멈춘다.
 */
export function priorRepetition(conversation: readonly ChatMessage[], name: string, args: unknown): PriorRepetition {
    const sigById = new Map<string, string>();
    const done: Array<{ sig: string; content: string }> = [];
    for (const m of conversation) {
        if (m.role === 'assistant') {
            for (const tc of m.tool_calls ?? []) if (tc.id) sigById.set(tc.id, signature(tc.function.name, tc.function.arguments));
        } else if (m.role === 'tool' && m.tool_call_id && sigById.has(m.tool_call_id)) {
            const content = typeof m.content === 'string' ? m.content : '';
            // 한 응답 안의 중복 호출에 준 짧은 결과는 실행 결과가 아니다 — 집계에서 뺀다(같은 결과 연속이 끊기지 않게).
            if (DUPLICATE_TOOL_CALL_RE.test(content)) continue;
            done.push({ sig: sigById.get(m.tool_call_id)!, content });
        }
    }
    const want = signature(name, args);
    let failures = 0;
    let sameResult = 0;
    let lastResult: string | undefined;
    let countingFailures = true;
    let countingSame = true;
    for (let i = done.length - 1; i >= 0 && done[i].sig === want && (countingFailures || countingSame); i--) {
        const err = isErrorResult(done[i].content);
        if (countingFailures && err) failures++; else countingFailures = false;
        if (countingSame && !err && (lastResult === undefined || done[i].content === lastResult)) {
            sameResult++;
            lastResult = done[i].content;
        } else countingSame = false;
    }
    return { failures, sameResult, ...(lastResult !== undefined ? { lastResult } : {}) };
}

/**
 * PURE: 반복 판정 — block 이면 실행하지 않고 blockedResult 를 결과로 쓴다.
 * 아니면 실행한 뒤 noteFor(result) 가 돌려주는 안내('' 이면 없음)를 결과 뒤에 붙인다.
 * 같은 결과 반복은 읽기 전용 호출에만 적용한다(쓰기·실행은 같은 출력이 정상일 수 있다).
 */
export function repetitionVerdict(
    prior: PriorRepetition, call: { readOnly: boolean; toolName?: string }, limits: LoopLimits,
): { block: boolean; blockedResult: string; noteFor: (result: string) => string } {
    const blockByFailures = prior.failures >= limits.blockFailures;
    const blockBySame = call.readOnly && prior.sameResult >= limits.blockSameResult;
    return {
        block: blockByFailures || blockBySame,
        blockedResult: getToolLoopBlockedResult(call.toolName ?? 'tool', blockByFailures ? prior.failures : prior.sameResult, blockByFailures ? 'failure' : 'same_result'),
        noteFor: (result: string): string => {
            if (isErrorResult(result)) {
                const n = prior.failures + 1;
                return n >= limits.warnFailures ? getToolLoopFailureNote(n) : '';
            }
            if (call.readOnly && prior.lastResult !== undefined && result === prior.lastResult) {
                const n = prior.sameResult + 1;
                return n >= limits.warnSameResult ? getToolLoopSameResultNote(n) : '';
            }
            return '';
        },
    };
}
