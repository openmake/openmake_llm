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

/** 도구 결과 뒤에 붙이는 반복 안내의 머리말 — 반복 가드(tool-loop-guard)가 앞선 결과를 비교할 때 이 줄을 뺀다. 안내는 한 줄이어야 한다. */
export const TOOL_LOOP_NOTE_MARKER = '\n\n[반복 안내]';

/** 주기 반복 가드 — 서로 다른 호출이 같은 결과로 번갈아 되풀이될 때 결과 뒤에 붙이는 안내. */
export function getToolLoopCycleNote(period: number, laps: number): string {
    return `${TOOL_LOOP_NOTE_MARKER} 서로 다른 호출 ${period}개가 같은 결과로 번갈아 ${laps}바퀴 되풀이됐습니다. 같은 순서를 반복해도 결과는 바뀌지 않습니다 — 접근을 바꾸거나, 더 진행할 수 없으면 지금까지의 결과로 마무리하세요.`;
}

/** 주기 반복 가드 — 임계를 넘어 실행하지 않았을 때의 결과. */
export function getToolLoopCycleBlockedResult(toolName: string, period: number, laps: number): string {
    return `Error: 이 호출(${toolName})은 서로 다른 호출 ${period}개가 같은 결과로 ${laps}바퀴 되풀이된 주기를 이어가는 것이어서 실행하지 않았습니다. 다른 인자나 다른 방법을 쓰고, 더 진행할 수 없으면 지금까지의 결과로 마무리하세요.`;
}

/** 같은 구간 다시 읽기 — 바뀌지 않은 같은 파일·같은 구간을 다시 읽었을 때 결과 뒤에 붙이는 안내(내용은 그대로 돌려준다). */
export function getRereadNote(): string {
    return `${TOOL_LOOP_NOTE_MARKER} 이미 읽은 구간이고 그 뒤로 파일이 바뀌지 않았습니다. 다시 읽지 말고 이 내용으로 다음 단계를 진행하세요. 다른 부분이 필요하면 start_line 을 바꿔 읽으세요.`;
}

/** 출력 반복 — 단계 기록에 남기는 문구. cut 이면 반복이 시작된 뒤를 잘라 냈다. */
export function getOutputRepetitionNote(repeats: number, windowChars: number, sample: string, cut = false): string {
    return `출력 반복 감지(${cut ? '반복이 시작된 뒤를 잘라 냄' : '기록만'}) — 응답 본문에서 ${windowChars}자 구간이 ${repeats}회 반복됐습니다: "${sample}"`;
}

/** 출력 반복 — 잘라 낸 자리에 붙이는 생략 표시(대화와, 그대로 최종 답이 되면 결과에 남는다). */
export const OUTPUT_REPETITION_CUT_MARKER = '\n\n[같은 내용이 되풀이되어 이후 출력을 생략했습니다]';

/** 출력 반복 — 최종 답이 될 응답이 반복으로 잘렸을 때 주입해 한 번 다시 받는다. 횟수는 대화에 남은 이 문구로 센다. */
export function getOutputRepetitionRetryNudge(): string {
    return '방금 응답은 같은 내용이 되풀이되어 뒤를 잘라 냈습니다. 같은 문장을 반복하지 말고, 최종 답변을 처음부터 한 번만 간결하게 다시 작성하세요.';
}

/** 출력 반복 다시 요청 — 단계 기록에 남기는 문구. */
export function getOutputRepetitionRetryNote(count: number, max: number): string {
    return `출력 반복으로 잘린 답변 — 다시 요청 ${count}/${max}`;
}

/** 검증이 보류한 답변을 턴 상한에서 결과로 쓸 때 남기는 표시 — 단계 기록과 진행 알림이 같은 문장을 쓴다. */
export function getVerifyHeldAnswerNote(gates: readonly string[]): string {
    return `검증 미통과: 검증 실패를 고치던 중 턴 상한에 도달해, 검증을 통과하지 못한 직전 답변을 결과로 남겼습니다${gates.length > 0 ? ` (통과하지 못했거나 다시 돌리지 않은 검증: ${gates.join(', ')})` : ''}. 결과를 직접 확인하세요.`;
}
