/**
 * 에이전트 작업 턴 루프의 안내문 — 오류 복구·응답 가드가 모델에게 돌려주거나 단계 기록에 남기는 문구.
 *
 * @module prompts/agent-task-turn-loop
 */

/** 재시도 소진 뒤 대기 — 단계 기록에 남기는 사유(오류 원문 + 기다리는 시간). */
export function getRecoveryWaitNote(error: string, waitMs: number): string {
    return `${error} — 짧은 재시도 소진, ${Math.round(waitMs / 1000)}초 기다린 뒤 다시 시도`;
}
