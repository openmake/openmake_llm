/**
 * 턴 응답 가드 — 빈 응답 판별과 같은 응답 반복 감지(AgentTaskService 에서 분리 — 파일 크기 가드).
 *
 * @module services/agent-task/turn-guards
 */
import type { ToolCall } from '../../llm/types';

interface TurnResult {
    content?: string | null;
    tool_calls?: ToolCall[];
}

/**
 * PURE: 본문도 도구 호출도 없는 응답. 로컬 모델이 가끔 내는 일시적 빈 응답을 그대로 최종 답변으로 받으면
 * 작업이 빈 결과로 끝나거나(판정 통과) 체크포인트가 지워진 채 실패한다(판정 미달성).
 */
export function isEmptyTurn(result: TurnResult): boolean {
    return (!result.tool_calls || result.tool_calls.length === 0) && !(result.content ?? '').trim();
}

/**
 * 같은 응답(본문 + 도구 호출의 이름·인자)이 threshold 회 연속인지. signatures 는 제자리 갱신한다(최근 threshold 개만 유지).
 * OpenManus BaseAgent.is_stuck 패턴 — 무한 루프·제자리 맴돌기 방지.
 */
export function pushStuckSignature(signatures: string[], result: TurnResult, threshold: number): boolean {
    const sig = JSON.stringify({
        c: result.content ?? '',
        t: (result.tool_calls ?? []).map((x) => ({ n: x.function.name, a: x.function.arguments })),
    });
    signatures.push(sig);
    if (signatures.length > threshold) signatures.shift();
    return signatures.length >= threshold && signatures.every((s) => s === sig);
}
