/**
 * 에이전트 작업 턴 루프의 안내문 — 오류 복구·응답 가드가 모델에게 돌려주거나 단계 기록에 남기는 문구.
 *
 * @module prompts/agent-task-turn-loop
 */

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
