/**
 * @module lib/report-task-intent
 * @description 채팅 → 에이전트 작업 자동 위임(P1 Phase 2) — 조사형 보고서 의도 감지.
 *
 * 첨부 없이 "X를 조사해서 보고서로 작성해줘" 류의 self-contained 조사+보고서 요청은
 * 스트리밍 채팅(도구 5턴 예산) 대신 에이전트 작업으로 위임한다 — 더 많은 조사 턴 +
 * 채팅 비블로킹. 백엔드가 goal 의 보고서 의도를 감지해 reportdata 계약을 주입하고,
 * 최종 답변을 고정 템플릿으로 렌더해 아티팩트 칩으로 인라인 표시한다.
 *
 * 위임하지 않는 경우:
 * - 조사 동사 없이 보고서만 요청("html 보고서로 만들어줘") — 채팅 P1 파이프라인이 처리
 * - 대화 맥락 참조("지금까지 내용을 보고서로") — 작업은 채팅 히스토리를 볼 수 없다
 *
 * 프론트 휴리스틱(L2 config) — 키워드는 아래 상수로 외부화. file-task-intent 와 동일 패턴.
 */

/** 보고서 산출물 명사 (부분일치, 소문자 비교). */
export const REPORT_NOUN_TOKENS: readonly string[] = [
  "보고서", "리포트", "report",
];

/** 조사·리서치 의도 동사 (self-contained 조사 요청 신호). */
export const RESEARCH_VERB_TOKENS: readonly string[] = [
  "조사", "리서치", "알아보", "검색해", "찾아보", "찾아서",
  "research", "investigate", "search",
];

/** 대화 맥락 참조 — 작업이 채팅 히스토리를 볼 수 없으므로 위임 제외. */
export const CONTEXT_REFERENCE_TOKENS: readonly string[] = [
  "지금까지", "위 내용", "이 내용", "방금", "아까", "지금 내용", "위의 내용",
];

/**
 * 메시지가 "조사해서 보고서 작성" 의도인지 판정.
 * 호출부에서 "첨부가 없는지"는 별도로 확인한다(이 함수는 텍스트 의도만).
 */
export function detectReportTaskIntent(text: string): boolean {
  const t = text.trim().toLowerCase();
  if (!t) return false;
  if (CONTEXT_REFERENCE_TOKENS.some((tok) => t.includes(tok))) return false;
  return (
    REPORT_NOUN_TOKENS.some((tok) => t.includes(tok)) &&
    RESEARCH_VERB_TOKENS.some((tok) => t.includes(tok))
  );
}
