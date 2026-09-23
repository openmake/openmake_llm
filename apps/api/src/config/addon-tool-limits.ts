/**
 * 내장 도구(web_search·web_scrape·agent task)의 결과·기본값 상한 (L2).
 *
 * No-Hardcoding 정책 ④ — 도구 구현에 흩어져 있던 스니펫 길이·결과 수·크롤 깊이 등
 * 튜닝 매직 넘버를 명명 상수로 모은다. 운영 배포별로 조정할 값이 아니라 내부 튜닝 값이므로
 * 평문 리터럴로 둔다(필요 시 env override 를 개별 추가).
 *
 * @module config/addon-tool-limits
 */

/** web_search / fact_check 내장 도구의 출력·결과 상한 */
export const WEB_SEARCH_TOOL_LIMITS = {
    /** web_search MCP 도구 출력(사용자 직접 표시)의 스니펫 요약 길이 */
    SNIPPET_CHARS: 100,
    /** fact_check 도구가 교차검증용으로 수집하는 검색 결과 수 */
    FACT_CHECK_MAX_RESULTS: 5,
    /** SearXNG 기본 provider 요청 최대 결과 수 */
    SEARXNG_MAX_RESULTS: 15,
    /** Wikipedia 검색 API 결과 수 (API 최대치가 아닌 우리 튜닝 캡) */
    WIKIPEDIA_MAX_RESULTS: 5,
    /** Google News RSS 파싱 항목 상한 */
    GOOGLE_NEWS_MAX_ITEMS: 10,
    /** DuckDuckGo 관련 주제의 제목 폴백 절단 길이 */
    DDG_TITLE_MAX_CHARS: 80,
} as const;

/** web_map / web_crawl 도구의 기본 인자 (사용자가 인자를 주지 않을 때) */
export const WEB_SCRAPER_TOOL_DEFAULTS = {
    /** web_map 기본 URL 수집 상한 */
    MAP_URL_LIMIT: 100,
    /** web_crawl 기본 크롤링 페이지 수 */
    CRAWL_PAGE_LIMIT: 10,
    /** web_crawl 기본 크롤링 깊이 */
    CRAWL_MAX_DEPTH: 2,
} as const;

/** list_agent_tasks 도구 목록 크기 상한 */
export const AGENT_TASK_LIST_LIMITS = {
    /** 기본 조회 개수 */
    DEFAULT: 10,
    /** 최대 조회 개수 */
    MAX: 30,
} as const;
