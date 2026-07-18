/**
 * NotebookLM 노트북 컨텍스트 프리픽스 — composer "Notebooks" picker 로 고정한 노트북을
 * 메시지 앞에 결정적으로 주입한다 (프론트 하드코딩 → 백엔드 프롬프트 계층 이전, 2026-07-18).
 *
 * - "notebooklm" 문자열 포함이 중요: tool-merger 의 서버 참조(depth) 매칭을 트리거해
 *   해당 서버의 allowlist 도구가 우선 노출된다.
 * - 언어: 사용자 언어가 한국어면 한국어, 그 외는 영어 지시문.
 */

export interface NotebookContextRef {
    id: string;
    title: string;
}

/** 프리픽스에 실을 title 최대 길이 (프롬프트 팽창 방지) */
const NOTEBOOK_TITLE_MAX = 200;

export function buildNotebookContextPrefix(notebook: NotebookContextRef, language: string): string {
    const title = notebook.title.slice(0, NOTEBOOK_TITLE_MAX);
    if (language === 'ko') {
        return `[NotebookLM 컨텍스트] 노트북 "${title}" (notebook_id: ${notebook.id}) — notebooklm 의 notebook_query 도구로 이 노트북에 질의해 근거 기반으로 답할 것.`;
    }
    return `[NotebookLM context] Notebook "${title}" (notebook_id: ${notebook.id}) — ground your answer in this notebook by querying it with the notebooklm notebook_query tool.`;
}
