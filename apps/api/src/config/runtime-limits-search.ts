/**
 * 런타임 제한값 — 웹검색 결과 주입 캡, 모델 출처 섹션 인식, 검색 escalation, SearXNG 카테고리 스코프.
 * 공개 진입점은 config/runtime-limits(이 파일을 re-export) — 소비처는 그쪽에서 import 한다.
 *
 * @module config/runtime-limits-search
 */

/**
 * 주입 캡 env 파싱 — 음수·NaN(잘못된 값)은 기본값으로, 0 은 "무제한"(캡 미적용) sentinel.
 * 가드 없는 parseInt 는 0/NaN 시 snippet 을 전부 비워 grounding 을 무너뜨릴 수 있어 명시 정규화한다.
 */
export function parseInjectLimit(raw: string | undefined, def: number): number {
    const n = parseInt(raw ?? '', 10);
    return Number.isFinite(n) && n >= 0 ? n : def;
}

/**
 * 채팅 웹검색 결과의 LLM 컨텍스트 주입 한도 (2026-06-25 TTFT 개선)
 * 검색은 다소스 수집(랭킹 풀)을 위해 넉넉히 하되, LLM 에 실제 주입하는 양은 캡한다.
 * 큰 검색 컨텍스트가 prompt prefill 을 키워 TTFT(첫 토큰)를 늘리는 것을 막는다 —
 * SearXNG·위키 디랭크로 상위 결과 품질이 좋아져 적은 수로도 정답을 유지한다.
 *
 * sockets/ws-chat-handler.ts 에서 참조
 */
export const WEB_SEARCH_INJECTION = {
    /**
     * 검색 수집(랭킹 풀) 결과 수 — SearXNG·위키 디랭크 포함 넉넉히 수집한 뒤 MAX_RESULTS 로 주입 캡.
     * WS 채팅·구조화(/structured) 경로가 공유한다.
     */
    COLLECT_MAX_RESULTS: parseInjectLimit(process.env.WEB_SEARCH_COLLECT_MAX_RESULTS, 12),
    /**
     * LLM 컨텍스트에 주입할 상위 결과 수 (수집은 더 많이 하되 주입은 캡). 0 = 무제한.
     * 6 → 10: 시사 쿼리에서 정답 포함 결과가 랭킹 하위(예: namu.wiki 현직 인물)로 밀려
     * top-6 컷오프에 잘리던 그라운딩 누락을 줄인다(수집 풀 12 의 대부분 주입).
     */
    MAX_RESULTS: parseInjectLimit(process.env.WEB_SEARCH_INJECT_MAX_RESULTS, 10),
    /** 결과당 주입 snippet 최대 글자 수 (초과 절단). 0 = 무제한(절단 안 함). 300→500: 결정적 사실이 스니펫 뒤쪽에 있어도 포함되게. */
    MAX_SNIPPET_CHARS: parseInjectLimit(process.env.WEB_SEARCH_INJECT_MAX_SNIPPET, 500),
    /**
     * 검색 쿼리 최대 글자 수 — 장문 프롬프트 전체가 웹검색 쿼리로 흘러가 provider URI 한도에
     * 걸리던 414(네이버 hub·Daum, 2026-08-21 라이브) 차단. 검색엔진 실효 질의는 앞부분 수십
     * 자로 충분하며, 초과분은 단어 경계에서 절단한다. 0 = 무제한.
     */
    QUERY_MAX_CHARS: parseInjectLimit(process.env.WEB_SEARCH_QUERY_MAX_CHARS, 200),
} as const;

/** 모델이 답변에 직접 쓴 출처 섹션의 인식 규칙 (services/chat-service/external-deterministic-append) */
export const MODEL_SOURCE_SECTION = {
    /** 평문 머리줄(`검색 결과 출처:`)에서 출처 라벨 앞에 올 수 있는 수식어의 최대 글자 수 — 넘으면 문장으로 본다 */
    LABEL_PREFIX_MAX_CHARS: 20,
} as const;

/**
 * 검색 escalation (Tier 1) — 무료 Tier 0 수집이 부족할 때만 공식 API(Exa)로 보강한다.
 * 판단은 결정적 개수 비교뿐 (LLM 판단 아님). Exa 무료 크레딧(월 $10 ≈ 1,400회) 절약을 위해
 * 평시(수집 충분)에는 절대 호출하지 않는다. EXA_API_KEY 미설정 시 전체 비활성.
 */
export const SEARCH_ESCALATION = {
    /** dedupe 후 수집 결과가 이 값 미만이면 Exa 보강. 0 = 비활성. env: SEARCH_ESCALATION_MIN_RESULTS */
    MIN_RESULTS: parseInjectLimit(process.env.SEARCH_ESCALATION_MIN_RESULTS, 5),
    /** escalation 시 Exa 요청 결과 수. env: SEARCH_ESCALATION_EXA_RESULTS */
    EXA_NUM_RESULTS: parseInjectLimit(process.env.SEARCH_ESCALATION_EXA_RESULTS, 10),
    /**
     * escalation Exa 호출 지연 상한(ms) — 병렬 배치 이후의 **직렬** 호출이라 채팅 TTFT 에
     * 그대로 가산되므로 provider fetch timeout(~12s)보다 훨씬 짧게 캡한다. 초과 시 보강 포기
     * (Tier 0 결과만으로 진행). 0 = 상한 없음. env: SEARCH_ESCALATION_TIMEOUT_MS
     */
    TIMEOUT_MS: parseInjectLimit(process.env.SEARCH_ESCALATION_TIMEOUT_MS, 4000),
} as const;

/**
 * SearXNG 카테고리 스코프 — 질의 성격에 맞는 카테고리를 추가 요청해 권위 소스를 보강한다.
 * (기본 general 은 google cse+ddg 뿐이라 블로그 위주 — `it` 은 github/mdn/docker hub,
 *  `science` 는 arxiv/pubmed/scholar 가 유입됨. 2026-08-14 인스턴스 실측.)
 * 감지는 결정적 regex 만 사용 (LLM 판단 경계 A형 금지 — CLAUDE.md).
 */
export const SEARXNG_CATEGORY_SCOPE = {
    /** 기술/개발 질의 → `it` 카테고리 (github·stackoverflow·mdn·pypi·docker hub).
     *  ⚠️ 단독 `코드` 같은 일반어 토큰 금지 — '할인 코드' 류 비기술 질의가 매칭돼 카테고리를 오염시킨다. */
    IT_PATTERN: /(에러|오류|버그|디버깅|코드\s?리뷰|코딩|라이브러리|프레임워크|컴파일|리액트|백엔드|프론트엔드|데이터베이스|프로그래밍|소스\s?코드|개발\s?환경|\bapi\b|\bsdk\b|\bnpm\b|\bpip\b|docker|kubernetes|github|typescript|javascript|python|\bjava\b|\brust\b|golang|react|next\.?js|node\.?js|\bsql\b)/i,
    /** 학술/논문 질의 → `science` 카테고리 (arxiv·pubmed·google scholar·semantic scholar).
     *  ⚠️ 단독 `paper`/`study` 금지 — 'paper towel'·'study cafe' 류 일반 질의 오매칭. */
    SCIENCE_PATTERN: /(논문|학술|저널|피인용|임상|의학\s?연구|arxiv|pubmed|scholar|preprint|research\s+paper|academic\s+paper|clinical\s+(trial|study))/i,
} as const;
