/**
 * 에이전트 작업 턴 루프의 안내문 — 오류 복구·응답 가드가 모델에게 돌려주거나 단계 기록에 남기는 문구.
 *
 * @module prompts/agent-task-turn-loop
 */

/** 일시적 LLM 오류 재시도 — 단계 기록에 남기는 문구. */
export function getTransientRetryNote(attempt: number, maxAttempts: number, error: string): string {
    return `일시적 LLM 오류 — 재시도 ${attempt}/${maxAttempts}: ${error}`;
}

/** 재시도 소진 뒤 대기 — 단계 기록에 남기는 사유(오류 원문 + 기다리는 시간). */
export function getRecoveryWaitNote(error: string, waitMs: number): string {
    return `${error} — 짧은 재시도 소진, ${Math.round(waitMs / 1000)}초 기다린 뒤 다시 시도`;
}

/** 도구 호출 없이 다음 행동 예고로 끝난 응답 뒤에 주입 — 예고한 일을 실제로 하게 한다. */
export function getAgentTaskStallNudge(): string {
    return '방금 응답은 다음에 할 일을 예고만 하고 끝났습니다. 예고한 작업을 지금 도구를 호출해 실제로 수행하세요. 목표를 이미 끝냈다면 예고 없이 최종 답변을 작성하세요.';
}

/** 행동 예고 재촉 — 단계 기록에 남기는 문구. */
export function getAgentTaskStallNote(count: number, max: number): string {
    return `행동 예고만 하고 멈춤 — 재촉 ${count}/${max}`;
}

/** 컨텍스트 절단 — 단계 기록에 남기는 문구. */
export function getContextTrimNote(dropped: number, total: number): string {
    return `컨텍스트 창 초과 — 이번 모델 호출에서 대화 ${total}건 중 오래된 메시지 ${dropped}건을 빼고 보냈습니다. 모델이 앞선 내용을 보지 못했을 수 있습니다.`;
}

/** 인자 JSON 이 깨진 도구 호출에 돌려주는 결과 — 실행하지 않았음을 알리고 다시 호출하게 한다. */
export function getMalformedToolArgsResult(toolName: string): string {
    return `Error: ${toolName} 호출의 인자가 올바른 JSON 이 아니어서 실행하지 않았습니다(출력이 중간에 잘렸을 수 있습니다). 인자를 완전한 JSON 으로 다시 작성해 호출하세요. 내용이 길면 여러 번에 나눠 호출하세요.`;
}

/** 한 응답 안의 중복 호출에 주는 결과의 머리말 — 반복 가드(tool-loop-guard)가 이 결과를 집계에서 빼는 데 쓴다. */
export const DUPLICATE_TOOL_CALL_PREFIX = '[중복 호출]';

/** 한 응답 안에서 앞선 호출과 이름·인자가 같은 호출에 주는 짧은 결과 — 다시 실행하지 않았고 어느 결과를 보면 되는지 알린다. */
export function getDuplicateToolCallResult(toolName: string, originalCallId: string | undefined): string {
    return `${DUPLICATE_TOOL_CALL_PREFIX} 같은 응답 안의 앞선 ${toolName} 호출${originalCallId ? `(${originalCallId})` : ''}과 이름·인자가 같아 다시 실행하지 않았습니다. 그 호출의 결과를 쓰세요.`;
}
