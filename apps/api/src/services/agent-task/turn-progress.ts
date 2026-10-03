/**
 * 턴 시작 시 진행률 계산 (AgentTaskService 에서 분리 — 파일 크기 가드).
 *
 * @module services/agent-task/turn-progress
 */

/**
 * PURE: 에이전트가 plan 을 세웠으면 실제 단계 완료율(completed/total)을 진척으로 쓴다
 * — "3/7 단계"처럼 실제 진행을 반영(1-C). plan 이 없으면(턴0·비플래닝 작업) 총 턴 수를
 * 알 수 없으므로 남은 거리의 고정 비율을 매 턴 채우는 점근 곡선으로 폴백(상한 90, 완료 100 은
 * 종료 경로가 설정). 둘 다 curProgress 아래로는 내려가지 않게 단조 증가 보장.
 */
export function nextTurnProgress(planSteps: ReadonlyArray<{ status: string }>, curProgress: number): number {
    if (planSteps.length > 0) {
        const done = planSteps.filter((s) => s.status === 'completed').length;
        const planPct = Math.round((done / planSteps.length) * 90);
        return Math.max(curProgress, Math.min(90, Math.max(2, planPct)));
    }
    return Math.min(90, curProgress + Math.max(4, Math.round((90 - curProgress) * 0.25)));
}
