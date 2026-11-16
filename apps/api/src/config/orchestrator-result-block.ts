/**
 * 오케스트레이터 작업 결과 블록의 머리글 이름 — 종합 모델에 넘기는 블록 안내문의 첫머리(orchestrate.ts)와
 * 최종 본문의 내부 표식 정리 규칙(services/orchestrator/result-markers.ts)이 같은 값을 쓰도록 한 곳에 둔다.
 * 모델이 이 이름을 인용 표식처럼 본문에 옮겨 쓰는 일이 있다(`[오케스트레이터 작업 결과 t1, 결과 6, 8]`).
 * 내부 구조 이름(오케스트레이터)은 생각(thinking)으로 사용자에게 보일 수 있어 싣지 않는다(2026-11-16 라이브).
 *
 * @module config/orchestrator-result-block
 */
export const RESULT_BLOCK_LABELS = {
    ko: '사전 작업 결과',
    en: 'Prepared task results',
} as const;

/** 옛 블록 이름 — 정리 전 저장본(이전 답변)의 표식을 모델이 흉내 낼 수 있어 본문 표식 정리는 계속 잡는다 */
export const RESULT_BLOCK_LEGACY_LABELS = ['오케스트레이터 작업 결과', 'Orchestrator task results'] as const;
