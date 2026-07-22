/**
 * @module lib/file-task-intent
 * @description 채팅 → 에이전트 작업 자동 위임(Option B) 의 의도 감지.
 *
 * 일반 채팅에서 파일을 첨부하고 "가공/편집/생성/정밀분석" 을 요청하면, 스트리밍 채팅
 * 대신 에이전트 작업(샌드박스 python — openpyxl/python-docx/reportlab)으로 자동 위임한다.
 * 순수 읽기/요약("이 파일 뭐야", "요약해줘")은 위임하지 않고 기존 채팅 추출 경로를 유지.
 *
 * 프론트 휴리스틱(L2 config) — 키워드는 아래 상수로 외부화. 백엔드/LLM 재분류 없이 즉시 판정.
 */

/**
 * 파일 가공·생성·정밀분석 의도를 나타내는 토큰(부분일치, 소문자 비교).
 * 순수 읽기 동사(요약/설명/뭐야/읽어)는 의도적으로 제외 — 그건 채팅이 더 빠르다.
 */
export const FILE_TASK_INTENT_TOKENS: readonly string[] = [
  // 편집·변환·가공 (한국어)
  "편집", "수정", "고쳐", "바꿔", "변경", "변환", "합쳐", "병합", "나눠", "분할",
  "계산", "합계", "평균", "집계", "피벗", "정렬", "필터", "추출", "채워", "정리",
  "작성", "생성", "만들", "저장", "다운로드", "분석",
  // 출력 포맷 힌트 (한국어)
  "엑셀", "xlsx", "워드", "docx", "pptx", "ppt", "pdf", "csv", "파일로", "시트",
  // English
  "edit", "modify", "convert", "merge", "split", "calculat", "average", "pivot",
  "sort", "filter", "extract", "generate", "create", "make", "save", "download",
  "export", "spreadsheet", "analyze", "analyse",
];

/**
 * 메시지가 "첨부 파일을 가공/생성" 하려는 의도인지 판정.
 * 호출부에서 "파일이 실제로 첨부됐는지" 는 별도로 확인한다(이 함수는 텍스트 의도만).
 */
export function detectFileTaskIntent(text: string): boolean {
  const t = text.trim().toLowerCase();
  if (!t) return false;
  return FILE_TASK_INTENT_TOKENS.some((tok) => t.includes(tok));
}
