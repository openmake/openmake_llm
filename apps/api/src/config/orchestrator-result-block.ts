/**
 * 오케스트레이터 작업 결과 블록의 머리글 이름 — 종합 모델에 넘기는 블록 안내문의 첫머리(orchestrate.ts)와
 * 최종 본문의 내부 표식 정리 규칙(services/orchestrator/result-markers.ts)이 같은 값을 쓰도록 한 곳에 둔다.
 * 모델이 이 이름을 인용 표식처럼 본문에 옮겨 쓰는 일이 있다(`[오케스트레이터 작업 결과 t1, 결과 6, 8]`).
 *
 * @module config/orchestrator-result-block
 */
export const RESULT_BLOCK_LABELS = {
    ko: '오케스트레이터 작업 결과',
    en: 'Orchestrator task results',
} as const;
