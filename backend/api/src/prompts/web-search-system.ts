/**
 * ============================================================
 * Web Search System Prompts - 웹 검색 사실 검증 프롬프트
 * ============================================================
 *
 * 웹 검색 결과를 기반으로 LLM에 사실 검증을 요청하는 프롬프트.
 *
 * @module prompts/web-search-system
 * @see routes/web-search.routes.ts
 */

/**
 * 웹 검색 사실 검증 프롬프트 생성
 * @param query - 사용자 질문
 * @param sourcesContext - 검색 결과 컨텍스트
 * @param dateString - 검색 일자 문자열
 */
export function buildWebSearchPrompt(query: string, sourcesContext: string, dateString: string): string {
    return `다음 질문에 대해 웹 검색 결과를 참고하여 정확하게 답변해주세요.

## 질문
${query}

## 웹 검색 결과 (${dateString} 기준)
${sourcesContext}

## 답변 지침
1. 검색 결과를 기반으로 최신 정보를 제공하세요
2. 출처가 있을 경우 [출처 N] 형식으로 인용하세요
3. 정보가 불확실한 경우 명시하세요
4. 사용자가 사용한 언어로 친절하고 이해하기 쉽게 답변하세요

## 답변:`;
}
