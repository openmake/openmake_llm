/**
 * @module config/extension-catalog-sync
 * @description 확장 카탈로그 원본 동기화·자격증명(마켓플레이스 남은 개발계획 v3.7 M4) — 플래그·명명 상수.
 *
 * 전부 opt-in(기본 OFF = 종전 동작: 관리자 수동 동기화만, 토큰은 요청 한정). 운영 기능 프로필이 켠다.
 * 값은 호출 시점에 `getConfig()`(system_settings overlay > env > 기본값)로 읽는다 — 재시작 없이 반영된다
 * (주기 타이머는 부팅 때 걸리고, 매 tick 마다 켜짐·간격을 다시 읽는다).
 *
 * - `EXTENSION_CATALOG_AUTO_SYNC_ENABLED`  주기 동기화 마스터 스위치. OFF 면 tick 이 아무것도 하지 않는다(DB 조회 0).
 * - `EXTENSION_CATALOG_SYNC_INTERVAL_MS`   원본별 동기화 간격(기본 6시간).
 */
import { getConfig } from './env';

export const EXTENSION_CATALOG_SYNC_KEYS = {
    AUTO_SYNC_ENABLED: 'EXTENSION_CATALOG_AUTO_SYNC_ENABLED',
    SYNC_INTERVAL_MS: 'EXTENSION_CATALOG_SYNC_INTERVAL_MS',
} as const;

/** 명명 상수 — 주기 점검·백오프·저장 한도 */
export const EXTENSION_CATALOG_SYNC_LIMITS = {
    /** 주기 점검 간격 — 이 간격마다 "간격이 지난 원본"을 고른다(동기화 간격 자체는 설정값) */
    TICK_MS: 5 * 60 * 1000,
    /** 한 tick 에 동기화하는 원본 수 상한 — GitHub API 를 몰아 부르지 않게 */
    MAX_SOURCES_PER_TICK: 3,
    /** 실패 백오프 — 연속 실패 n 회면 간격 × 2^n, 상한 아래 */
    BACKOFF_MAX_MS: 48 * 60 * 60 * 1000,
    /** 429·GitHub rate limit 은 일반 실패보다 한 단계 더 물러난다 */
    RATE_LIMIT_BACKOFF_FACTOR: 2,
    /** 저장하는 실패 사유 길이 상한 */
    ERROR_MAX_CHARS: 500,
    /** 원본 접근 토큰 길이 상한 (요청 한정 토큰 스키마와 같다) */
    CREDENTIAL_MAX_CHARS: 200,
    /** 하위 경로 길이 상한 */
    SUBPATH_MAX_CHARS: 200,
} as const;

/** 하위 경로 — 저장소 상대 디렉터리. `..`·절대 경로·역슬래시 금지 */
export const CATALOG_SUBPATH_PATTERN = /^(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/;

export type CatalogSyncStatus = 'ok' | 'error' | 'rate_limited';

export const EXTENSION_CATALOG_SYNC_SETTINGS = {
    get autoSyncEnabled(): boolean {
        return getConfig().extensionCatalogAutoSyncEnabled;
    },
    get intervalMs(): number {
        return getConfig().extensionCatalogSyncIntervalMs;
    },
} as const;

/** PURE: 하위 경로 정규화 — 앞뒤 `/`·`./` 제거, 빈 값 = null(저장소 루트). 형식이 틀리면 throw */
export function normalizeCatalogSubpath(raw: string | null | undefined): string | null {
    if (raw === null || raw === undefined) return null;
    const v = raw.trim().replace(/^\.\//, '').replace(/^\/+|\/+$/g, '');
    if (v === '') return null;
    if (v.length > EXTENSION_CATALOG_SYNC_LIMITS.SUBPATH_MAX_CHARS || !CATALOG_SUBPATH_PATTERN.test(v)) {
        throw new Error('INVALID_CATALOG_SUBPATH: 저장소 상대 디렉터리여야 합니다 (예: plugins/market, .. 금지)');
    }
    return v;
}
