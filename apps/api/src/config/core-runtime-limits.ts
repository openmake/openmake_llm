/**
 * ============================================================
 * 코어 런타임 제한값 (no-hardcoding sweep)
 * ============================================================
 * sockets/llm/providers/utils/agents/cluster/monitoring/observability 등
 * 코어 인프라 경로에 흩어져 있던 임계값·기본 한도·진단 임계를 한곳에 모은 것.
 * 기존 config/*.ts(timeouts·runtime-limits·llm-parameters)에 이미 있는 값은
 * 중복 정의하지 않고 그쪽을 import 한다.
 *
 * @module config/core-runtime-limits
 */

// ============================================
// 웹 스크래퍼 크롤/맵 기본 한도
// ============================================

/**
 * mapSiteUrls / crawlSite 의 옵션 미지정 시 기본 한도.
 * 호출자가 options 로 넘기면 그 값이 우선한다(여기 값은 fallback).
 */
export const WEB_SCRAPE_LIMITS = {
    /** mapSiteUrls: 수집할 최대 URL 수 */
    MAP_DEFAULT_MAX_URLS: Number(process.env.WEB_SCRAPE_MAP_MAX_URLS) || 100,
    /** crawlSite: 방문할 최대 페이지 수 */
    CRAWL_DEFAULT_MAX_PAGES: Number(process.env.WEB_SCRAPE_CRAWL_MAX_PAGES) || 10,
    /** crawlSite: 최대 크롤 깊이 */
    CRAWL_DEFAULT_MAX_DEPTH: Number(process.env.WEB_SCRAPE_CRAWL_MAX_DEPTH) || 2,
} as const;

// ============================================
// 스트림 진단 임계
// ============================================

/** 첫 SSE 청크(TTFC) 지연이 이 값(ms)을 넘을 때만 warn 로그 — fast-fail 진단용 */
export const STREAM_TTFC_WARN_MS = Number(process.env.STREAM_TTFC_WARN_MS) || 3000;

// ============================================
// 알림 시스템 기본값 (constructor 미지정 시 fallback)
// ============================================

/**
 * AlertSystem 생성자에 config 를 넘기지 않았을 때 쓰는 기본 임계값·용량.
 * 명시 config 가 있으면 그쪽이 우선한다.
 */
export const ALERT_DEFAULTS = {
    /** 할당량 경고 임계값 (%) */
    QUOTA_WARNING_PERCENT: 70,
    /** 할당량 위험 임계값 (%) */
    QUOTA_CRITICAL_PERCENT: 90,
    /** 에러율 경고 임계값 (%) */
    ERROR_RATE_PERCENT: 10,
    /** 중복 알림 방지 쿨다운 (분) */
    COOLDOWN_MINUTES: 15,
    /** 인메모리 알림 히스토리 보관 최대 건수 */
    HISTORY_MAX_ENTRIES: 100,
} as const;

// ============================================
// 라우팅 기본 신뢰도
// ============================================

/** 키워드 매칭이 없을 때 기본 범용 에이전트에 부여하는 신뢰도 */
export const ROUTER_DEFAULT_CONFIDENCE = 0.3;
