/**
 * MCP Registry 동기화(M7)의 이름 붙은 값 — 플래그·주소·고정 스키마·주기·상한.
 *
 * 공식 레지스트리(registry.modelcontextprotocol.io)는 아직 preview 다("breaking changes or data resets may occur").
 * 그래서 server.json 스키마 버전을 고정하고(`PINNED_SERVER_SCHEMA`) 모르는 스키마의 항목은 저장하지 않고 건너뛴다.
 * API 는 `GET /v0.1/servers?cursor=&limit=(≤100)&updated_since=(RFC3339)&version=latest` — 응답 `metadata.nextCursor` 로
 * 다음 페이지를 잇고, `updated_since` 를 주면 삭제된 항목(status=deleted)도 함께 온다(2026-11-28 openapi.yaml 확인).
 *
 * @module addons/extension-marketplace/registry/constants
 */

/** 동기화 켜기(기본 OFF) — 꺼져 있으면 외부 요청 0, DB 조회도 하지 않는다. tick 마다 읽어 재시작 없이 반영된다 */
export const REGISTRY_SYNC_FLAG = 'EXT_MARKET_MCP_REGISTRY_SYNC';

/** 원본 식별자 — 표의 source_id. 지금은 공식 레지스트리 하나 */
export const REGISTRY_SOURCE_ID = 'official';

function envInt(name: string, fallback: number, min: number, max: number): number {
    const n = Number.parseInt(process.env[name] || '', 10);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, n));
}

/** 레지스트리 주소 — 사내 미러를 쓸 때만 바꾼다(SSRF 가드는 그대로 지난다) */
export function registryBaseUrl(): string {
    return (process.env.EXT_MARKET_MCP_REGISTRY_URL || 'https://registry.modelcontextprotocol.io').replace(/\/+$/, '');
}

export const REGISTRY_SERVERS_PATH = '/v0.1/servers';

/** 저장하는 server.json 스키마 — 이것과 다른 `$schema` 의 항목은 건너뛴다(새 스키마는 검토 후 이 값을 올린다) */
export const PINNED_SERVER_SCHEMA = 'https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json';

/** 레지스트리 메타 키(공식 확장) */
export const OFFICIAL_META_KEY = 'io.modelcontextprotocol.registry/official';

export const REGISTRY_LIMITS = {
    /** 한 페이지 항목 수(API 상한 100) */
    PAGE_SIZE: 100,
    /** tick 한 번에 받는 최대 페이지 — 넘으면 커서를 저장하고 다음 tick 에 잇는다 */
    PAGES_PER_TICK: envInt('EXT_MARKET_MCP_REGISTRY_PAGES_PER_TICK', 20, 1, 500),
    /** 전체 동기화 완료 후 다음 증분까지 간격(기본 6시간, 최소 10분) */
    SYNC_INTERVAL_MS: envInt('EXT_MARKET_MCP_REGISTRY_INTERVAL_MS', 6 * 60 * 60 * 1000, 10 * 60 * 1000, 7 * 24 * 60 * 60 * 1000),
    /** tick 주기 — 플래그·만기·백오프를 확인하는 간격(요청은 만기일 때만) */
    TICK_MS: envInt('EXT_MARKET_MCP_REGISTRY_TICK_MS', 5 * 60 * 1000, 10_000, 60 * 60 * 1000),
    /** 부팅 후 첫 tick 까지 */
    FIRST_TICK_DELAY_MS: 60_000,
    /** 요청 1회 시간 상한 */
    FETCH_TIMEOUT_MS: 20_000,
    /** 응답 본문 상한(바이트) — 100개 페이지는 실측 ~60KB */
    MAX_RESPONSE_BYTES: 4 * 1024 * 1024,
    /** 증분 기준 시각의 여유(레지스트리 시계·전파 지연) */
    WATERMARK_SKEW_MS: 10 * 60 * 1000,
    /** Retry-After 가 없을 때의 429 대기 */
    DEFAULT_RETRY_AFTER_MS: 60_000,
    /** 실패 백오프: 기본·상한 */
    BACKOFF_BASE_MS: 60_000,
    BACKOFF_MAX_MS: 6 * 60 * 60 * 1000,
    /** 저장 필드 길이 상한 */
    MAX_TEXT: 2000,
    MAX_REMOTES: 10,
    MAX_PACKAGES: 10,
    MAX_ENV_VARS: 30,
} as const;
