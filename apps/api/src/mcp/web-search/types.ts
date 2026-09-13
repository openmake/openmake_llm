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

