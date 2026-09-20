/**
 * Web Search 타입 정의
 *
 * 모든 검색 소스에서 공유하는 인터페이스를 정의합니다.
 *
 * @module mcp/web-search/types
 */

/**
 * 검색 결과 인터페이스
 *
 * 모든 검색 소스에서 반환되는 통일된 결과 형식입니다.
 *
 * @interface SearchResult
 */
/**
 * 클라이언트 인용 미리보기용 구조화 출처(F19.4) — `[N]` 번호가 formatSearchSources 출력과 같도록 같은 배열·순서·캡으로 만든다.
 */
export interface SearchSourceRef {
    /** 1부터 — 본문 [N] 과 같은 번호 */
    n: number;
    title: string;
    url: string;
    snippet: string;
    /** 결과 도메인(표시용) */
    source?: string;
}

export interface SearchResult {
    /** 검색 결과 제목 */
    title: string;
    /** 결과 URL */
    url: string;
    /** 결과 스니펫(요약) */
    snippet: string;
    /** 전체 콘텐츠 (스크래핑 시) */
    fullContent?: string;
    /** 검색 소스 도메인 (예: 'google.com', 'wikipedia.org') */
    source: string;
    /** 게시 날짜 */
    date?: string;
    /** 품질 점수 (0-1) */
    qualityScore?: number;
    /** 카테고리 분류 */
    category?: string;
}

