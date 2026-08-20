/**
 * ============================================================
 * Web Scraper Config (L2) — UA · 구조화 소스 · 차단우회 정책
 * ============================================================
 * CLAUDE.md No-Hardcoding Policy 에 따라 스크래퍼 정책을 명명 상수로 외부화.
 * utils/web-scraper.ts · utils/web-scraper-handlers.ts · utils/impersonate-fetch.ts 에서 참조.
 *
 * @module config/web-scraper
 */

export const SCRAPER_CONFIG = {
    /**
     * 외부 요청 User-Agent. 봇임을 명시하던 'OpenMakeBot/1.0' 대신 현실적 브라우저 UA 로
     * UA 기반 약한 봇 차단을 통과한다. (TLS fingerprint 차단은 impersonate 경로 담당)
     */
    USER_AGENT: process.env.SCRAPER_USER_AGENT
        || 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',

    /** 구조화 소스 핸들러(YouTube oEmbed · HN Algolia) 사용 (기본 on) */
    STRUCTURED_SOURCE_ENABLED: process.env.SCRAPER_STRUCTURED_ENABLED !== 'false',

    /** RSS 폴백(본문 0일 때) 사용 (기본 on) */
    RSS_FALLBACK_ENABLED: process.env.SCRAPER_RSS_FALLBACK_ENABLED !== 'false',

    /**
     * 차단 우회(curl_cffi TLS 임퍼소네이션) — **기본 OFF**.
     * 운영 활성화: 서버에 `pip install curl_cffi` 후 SCRAPER_IMPERSONATE_ENABLED=true.
     * ToS 회색지대·유지보수 부담이 있어 옵트인.
     */
    IMPERSONATE_ENABLED: process.env.SCRAPER_IMPERSONATE_ENABLED === 'true',

    /** 차단 우회 허용 도메인 화이트리스트 (SSRF·남용 방지 — 명시 소셜 사이트만) */
    IMPERSONATE_WHITELIST: (process.env.SCRAPER_IMPERSONATE_WHITELIST
        || 'reddit.com,www.reddit.com,old.reddit.com,oauth.reddit.com')
        .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),

    /** curl_cffi 임퍼소네이션 브라우저 프로필 (curl_cffi 0.16 지원 목록 기준) */
    IMPERSONATE_TARGET: process.env.SCRAPER_IMPERSONATE_TARGET || 'chrome136',

    /**
     * 봇 챌린지 안내 페이지 판별 제목 패턴 (소문자 부분일치) — fetch/Playwright 가 챌린지
     * 페이지("Just a moment...")를 정상 본문으로 반환하던 갭 차단, 임퍼소네이션 폴백 트리거.
     */
    BOT_CHALLENGE_TITLE_PATTERNS: (process.env.SCRAPER_BOT_CHALLENGE_TITLES
        || 'just a moment,attention required,access denied,verify you are human,verifying you are human,security check')
        .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),

    /** 차단 우회 응답 최대 바이트 (메모리 보호) */
    IMPERSONATE_MAX_BYTES: parseInt(process.env.SCRAPER_IMPERSONATE_MAX_BYTES || '5000000', 10),

    /** 차단 우회 타임아웃 (ms) */
    IMPERSONATE_TIMEOUT_MS: parseInt(process.env.SCRAPER_IMPERSONATE_TIMEOUT_MS || '15000', 10),

    /** python3 실행 경로 (curl_cffi 호출용) */
    PYTHON_BIN: process.env.SCRAPER_PYTHON_BIN || 'python3',

    /** 스크랩 결과 KVStore 캐시 (기본 on) — 동일 URL 반복 fetch 방지 (G1, 2026-08-08) */
    CACHE_ENABLED: process.env.SCRAPER_CACHE_ENABLED !== 'false',

    /** 스크랩 캐시 TTL (ms, 기본 30분) */
    CACHE_TTL_MS: parseInt(process.env.SCRAPER_CACHE_TTL_MS || String(30 * 60 * 1000), 10),

    /** 캐시 저장 상한 (bytes) — 초과 결과는 캐시하지 않음 (redis 메모리 보호) */
    CACHE_MAX_BYTES: parseInt(process.env.SCRAPER_CACHE_MAX_BYTES || '1000000', 10),

    /**
     * URL 정규화 시 제거할 트래킹 쿼리 파라미터 (G4). `*` 종결 항목은 prefix 매칭.
     * fragment(#...) 는 항목과 무관하게 항상 제거된다.
     */
    TRACKING_PARAMS: (process.env.SCRAPER_TRACKING_PARAMS
        || 'utm_*,gclid,fbclid,igshid,mc_cid,mc_eid,ref_src,spm,si,ck_subscriber_id')
        .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
} as const;

/**
 * 브라우저 유사 헤더 세트 (UA + Sec-CH-UA + Accept).
 * safeFetch 의 일반 경로에서 사용해 봇 식별 표면을 줄인다.
 */
export function browserHeaders(): Record<string, string> {
    return {
        'User-Agent': SCRAPER_CONFIG.USER_AGENT,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
        'Sec-CH-UA': '"Chromium";v="120", "Not(A:Brand";v="24", "Google Chrome";v="120"',
        'Sec-CH-UA-Mobile': '?0',
        'Sec-CH-UA-Platform': '"macOS"',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Upgrade-Insecure-Requests': '1',
    };
}
