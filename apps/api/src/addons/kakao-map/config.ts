/**
 * kakao-map add-on 설정 (L2) — 의도 패턴·임베드 설정. 종전 config/runtime-limits.ts 에서 옮겼다(2026-09-19).
 *
 * @module addons/kakao-map/config
 */

/**
 * 위치/지도 의도 판정 패턴. 매칭 시 카카오 검색 도구를 강제 포함하고 첫 턴에 강제 호출하며,
 * 시스템 프롬프트에 네이티브 지도 블록(```kakaomap) 사용을 넛지한다.
 */
export const MAP_INTENT_PATTERNS: readonly RegExp[] = [
    /지도/,
    /길\s*찾기/,
    /좌표/,
    /위치/,
    /근처/,
    /어디\b/,
] as const;

/**
 * 길찾기(경로) 의도 판정 패턴. 매칭 시 카카오 find-route 도구를 강제 포함·호출해
 * 출발/도착 마커 + 경로를 지도에 표시한다. (MAP_INTENT 의 부분집합 — 경로 전용)
 */
export const ROUTE_INTENT_PATTERNS: readonly RegExp[] = [
    /길\s*찾기/,
    /경로/,
    /가는\s*(길|법|방법)/,
    /어떻게\s*가/,
    /까지\s*(가|어떻게|경로|길)/,
] as const;

/** 카카오 지도 임베드 HTML (네이티브 앱 WKWebView 용) */
export const KAKAO_MAP_EMBED = {
    /** 정적 HTML 이라 캐시 허용 — 장소 데이터는 앱이 주입하므로 응답에 없다 */
    CACHE_SECONDS: Number(process.env.KAKAO_MAP_EMBED_CACHE_SECONDS) || 3600,
    /** 단일 지점일 때의 기본 확대 레벨 (카카오 기준: 작을수록 확대) */
    DEFAULT_LEVEL: Number(process.env.KAKAO_MAP_EMBED_DEFAULT_LEVEL) || 4,
} as const;
