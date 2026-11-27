/**
 * @module config/extension-catalog-index
 * @description 확장 카탈로그 정적 색인(index.json, 마켓플레이스 남은 개발계획 v3.7 M6) — 형식 상수·한도.
 *
 * 큐레이션 저장소 CI 가 만든 `index.json` 하나로 카탈로그를 동기화한다(GitHub API 다회 호출·무인증 rate limit 회피).
 * 켜짐은 `EXTENSION_CATALOG_INDEX_ENABLED`(config/extension-catalog-sync) + 원본별 `index_url` 둘 다 있을 때만.
 *
 * 형식 사본: 큐레이션 저장소 `openmake/openmake-marketplace` 의 `schema/catalog-index.v1.schema.json` 과
 * 이 레포 `agents/git-ingest/__tests__/fixtures/catalog-index/` 의 사본이 같아야 한다 — 형식을 바꾸면 버전을 올린다
 * (모르는 버전은 읽지 않고 종전 방식으로 폴백).
 */

/** 색인 식별자·지원 버전 — 이 값이 아닌 색인은 읽지 않는다(폴백) */
export const CATALOG_INDEX_FORMAT = {
    SCHEMA_ID: 'openmake.catalog-index',
    SUPPORTED_VERSION: 1,
} as const;

export const CATALOG_INDEX_LIMITS = {
    /** 색인 본문 상한 — 넘으면 폴백 */
    MAX_BYTES: 5 * 1024 * 1024,
    /** 색인 요청 시간 상한 */
    FETCH_TIMEOUT_MS: 15_000,
    /** 색인 항목 수 상한 */
    MAX_PLUGINS: 2000,
    /** index_url 길이 상한 */
    URL_MAX_CHARS: 500,
} as const;

/** 폴백 사유 코드 — sync_status=ok + last_sync_error 경고로 남는다 */
export const CATALOG_INDEX_FALLBACK_CODES = {
    FETCH_FAILED: 'INDEX_FETCH_FAILED',
    PARSE_FAILED: 'INDEX_PARSE_FAILED',
    SCHEMA_UNSUPPORTED: 'INDEX_SCHEMA_UNSUPPORTED',
    SHAPE_INVALID: 'INDEX_SHAPE_INVALID',
    HASH_MISMATCH: 'INDEX_HASH_MISMATCH',
    REPOSITORY_MISMATCH: 'INDEX_REPOSITORY_MISMATCH',
} as const;

export type CatalogIndexFallbackCode = typeof CATALOG_INDEX_FALLBACK_CODES[keyof typeof CATALOG_INDEX_FALLBACK_CODES];

/** PURE: index_url 정규화 — 빈 값 = null(색인 미사용). https 만, 자격증명·조각 금지. 형식이 틀리면 throw */
export function normalizeCatalogIndexUrl(raw: string | null | undefined): string | null {
    if (raw === null || raw === undefined) return null;
    const v = raw.trim();
    if (v === '') return null;
    let u: URL;
    try { u = new URL(v); } catch { throw new Error('INVALID_CATALOG_INDEX_URL: URL 형식이 아닙니다'); }
    if (u.protocol !== 'https:') throw new Error('INVALID_CATALOG_INDEX_URL: https 주소만 쓸 수 있습니다');
    if (u.username || u.password) throw new Error('INVALID_CATALOG_INDEX_URL: 주소에 자격증명을 넣을 수 없습니다');
    if (u.hash) throw new Error('INVALID_CATALOG_INDEX_URL: # 조각은 쓸 수 없습니다');
    if (v.length > CATALOG_INDEX_LIMITS.URL_MAX_CHARS) throw new Error('INVALID_CATALOG_INDEX_URL: 주소가 너무 깁니다');
    return u.toString();
}
