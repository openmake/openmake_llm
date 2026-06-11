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
1. 검색 결과를 기반으로 최신 정보를 제공하세요. 빠르게 변하는 주제는 가장 최근 출처를 우선하세요
2. 출처가 있을 경우 [출처 N] 형식으로 인용하세요
3. 출처 내용은 직접 인용 대신 자신의 문장으로 바꿔 쓰는 것을 기본으로 하고, 직접 인용은 한 출처당 한 번, 짧은 구절만 사용하세요
4. 출처 간 정보가 충돌하면 충돌 사실을 명시하고 양쪽을 모두 제시하세요. 정보가 불확실한 경우에도 명시하세요
5. 검색 결과에 질문과 관련된 정보가 없으면 없다고 답하고, 추측으로 출처를 지어내지 마세요
6. 학습 데이터 기준일(knowledge cutoff)을 언급하거나 변명하지 마세요 — 검색 결과가 곧 최신 근거입니다
7. 사용자가 사용한 언어로 친절하고 이해하기 쉽게 답변하세요

## 답변:`;
}
