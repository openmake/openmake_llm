/**
 * 확장 카탈로그 원본 동기화 (마켓플레이스 남은 개발계획 v3.7 M4) — 수동 동기화 라우트와 주기 동기화가 같은 함수를 쓴다.
 *
 * 한 번의 동기화:
 *   1. 토큰 = 요청 한정 토큰 > 저장된 원본 토큰(암호문 복호화) > 없음. 저장 토큰은 이 함수 밖으로 나가지 않는다.
 *   2. 스냅샷 = ExtensionIngestService.fetchCatalogSnapshot(원본 정책 M2 검사 포함, 하위 경로 적용) → 전체 교체.
 *   3. 결과 기록 = sync_status(ok·error·rate_limited)·last_sync_error(자격증명 마스킹)·last_sync_attempt_at.
 *   (M6) `EXTENSION_CATALOG_INDEX_ENABLED` + 원본 index_url 이면 2 대신 정적 색인 하나로 스냅샷을 만든다(요청 1회).
 *   색인을 쓸 수 없으면(받기 실패·형식·해시·저장소 불일치) 종전 방식으로 동기화하고, 성공(ok)이어도 last_sync_error 에
 *   폴백 경고를 남긴다. 원본 정책 거절(EXTENSION_SOURCE_BLOCKED)은 폴백하지 않고 그대로 실패다.
 *   실패는 기록한 뒤 다시 던진다(수동 라우트가 종전처럼 400 으로 알린다).
 *
 * 주기 동기화(opt-in `EXTENSION_CATALOG_AUTO_SYNC_ENABLED`): 5분 tick 이 켜짐·간격을 매번 다시 읽고(재시작 불필요),
 * 간격이 지난 enabled 원본을 tick 당 상한만큼 차례로 동기화한다. 꺼져 있으면 tick 은 DB 를 읽지 않는다.
 * 연속 실패는 간격 × 2^n(rate limit 은 한 단계 더), 상한까지 물러난다 — 실패 횟수는 프로세스 메모리(재시작 시 초기화).
 * 타이머는 자체 모듈 타이머라 schedulers/index.ts 의 stopAllSchedulers 가 stopCatalogAutoSync 를 직접 부른다.
 *
 * @module services/extensions/catalog-sync
 */
import { createLogger } from '../../utils/logger';
import { redactSecrets } from '../../utils/redact';
import { decryptToken, isDecryptionFailure } from '../../utils/token-crypto';
import {
    EXTENSION_CATALOG_SYNC_LIMITS,
    EXTENSION_CATALOG_SYNC_SETTINGS,
    type CatalogSyncStatus,
} from '../../config/extension-catalog-sync';
import type { ExtensionCatalogRow } from '../../data/repositories/extension-catalog-repository';
import type { CatalogSnapshot } from '../../agents/git-ingest/catalog-snapshot';
import { CatalogIndexFallbackError } from '../../agents/git-ingest/catalog-index';
import { applyDefaultCatalogAlias, type CatalogAliasRepo } from './catalog-alias';

const logger = createLogger('ExtensionCatalogSync');

/** 이 모듈이 쓰는 저장소 연산 (테스트가 주입) */
export interface CatalogSyncRepo {
    listEnabled(): Promise<ExtensionCatalogRow[]>;
    updateSnapshot(id: string, input: CatalogSnapshot): Promise<ExtensionCatalogRow | null>;
    /** warning — status 가 ok 일 때만 남는 경고(M6 색인 폴백). 없으면 지운다 */
    recordSyncResult(id: string, status: CatalogSyncStatus, error: string | null, warning?: string | null): Promise<void>;
    /** 이름 설치 별칭 기본값(M5) — 없으면 건너뛴다 */
    setAlias?: CatalogAliasRepo['setAlias'];
}

/** 이 모듈이 쓰는 설치 엔진 연산 (ExtensionIngestService 부분) */
export interface CatalogSyncService {
    fetchCatalogSnapshot(
        url: string,
        accessToken: string | undefined,
        policy: { userId?: string; action: 'catalog-sync' },
        subpath?: string | null,
    ): Promise<CatalogSnapshot>;
    translateCatalogSnapshot(snapshot: CatalogSnapshot, previous?: CatalogSnapshot['plugins']): Promise<void>;
    /** M6 정적 색인 스냅샷 — 없으면(구 구현) 색인을 쓰지 않는다 */
    fetchCatalogSnapshotFromIndex?(
        indexUrl: string,
        catalogUrl: string,
        policy: { userId?: string; action: 'catalog-sync' },
    ): Promise<CatalogSnapshot>;
}

export interface CatalogSyncDeps {
    repo: CatalogSyncRepo;
    service: CatalogSyncService;
}

export interface CatalogSyncOutcome {
    row: ExtensionCatalogRow | null;
    snapshot: CatalogSnapshot;
    /** 스냅샷을 만든 방식 — index = 정적 색인(M6), legacy = 종전 */
    via: 'index' | 'legacy';
}

/**
 * 스냅샷 받기 — 색인(M6)을 쓸 수 있으면 색인, 아니면 종전 방식. 색인 폴백 사유는 warning 으로 돌려준다.
 * 색인 경로가 정책 거절 등 폴백 대상이 아닌 오류를 던지면 그대로 던진다.
 */
async function fetchSnapshotPreferIndex(
    deps: CatalogSyncDeps,
    row: ExtensionCatalogRow,
    token: string | undefined,
    userId: string | undefined,
): Promise<{ snapshot: CatalogSnapshot; via: 'index' | 'legacy'; warning: string | null }> {
    const policy = { userId, action: 'catalog-sync' as const };
    let warning: string | null = null;
    if (EXTENSION_CATALOG_SYNC_SETTINGS.indexEnabled && row.index_url && deps.service.fetchCatalogSnapshotFromIndex) {
        try {
            const snapshot = await deps.service.fetchCatalogSnapshotFromIndex(row.index_url, row.url, policy);
            return { snapshot, via: 'index', warning: null };
        } catch (err) {
            if (!(err instanceof CatalogIndexFallbackError)) throw err;
            warning = sanitizeSyncError(`${err.message} — 종전 방식으로 동기화했습니다`);
            logger.warn(`카탈로그 색인 폴백 (${row.id}): ${warning}`);
        }
    }
    const snapshot = await deps.service.fetchCatalogSnapshot(row.url, token, policy, row.source_subpath ?? null);
    return { snapshot, via: 'legacy', warning };
}

/** PURE: 실패 사유 분류 — GitHub rate limit·HTTP 429 는 rate_limited */
export function classifySyncError(message: string): CatalogSyncStatus {
    return /GITHUB_RATE_LIMITED|\b429\b|rate limit/i.test(message) ? 'rate_limited' : 'error';
}

/** PURE: 저장·로그용 사유 — 쓴 토큰 값을 지우고, 자격증명 패턴을 가리고, 길이를 자른다 */
export function sanitizeSyncError(message: string, token?: string): string {
    let out = message;
    if (token && token.length >= 4) out = out.split(token).join('***');
    out = redactSecrets(out);
    return out.length > EXTENSION_CATALOG_SYNC_LIMITS.ERROR_MAX_CHARS
        ? out.slice(0, EXTENSION_CATALOG_SYNC_LIMITS.ERROR_MAX_CHARS)
        : out;
}

/** 저장된 원본 토큰 — 복호화 실패·없음 = undefined(무인증으로 진행, 값은 로그에 남기지 않는다) */
export function storedCredential(row: Pick<ExtensionCatalogRow, 'id' | 'credential_encrypted'>): string | undefined {
    const enc = row.credential_encrypted;
    if (!enc) return undefined;
    try {
        const plain = decryptToken(enc);
        if (isDecryptionFailure(plain)) {
            logger.warn(`카탈로그 원본 토큰 복호화 실패 — 무인증으로 동기화 (${row.id})`);
            return undefined;
        }
        return plain;
    } catch {
        logger.warn(`카탈로그 원본 토큰 복호화 오류 — 무인증으로 동기화 (${row.id})`);
        return undefined;
    }
}

/**
 * 원본 하나 동기화 — 성공이면 스냅샷 교체 + ok 기록, 실패면 사유 기록 후 다시 던진다.
 * 번역(LLM)은 호출측이 응답 뒤 백그라운드로(수동 라우트 CF 100s 상한).
 */
export async function syncCatalogSource(
    deps: CatalogSyncDeps,
    row: ExtensionCatalogRow,
    opts: { accessToken?: string; userId?: string } = {},
): Promise<CatalogSyncOutcome> {
    const token = opts.accessToken || storedCredential(row);
    try {
        const { snapshot, via, warning } = await fetchSnapshotPreferIndex(deps, row, token, opts.userId);
        let updated = await deps.repo.updateSnapshot(row.id, snapshot);
        // 별칭이 비어 있으면 새 스냅샷 name 으로(M5 — 207 이전 원본도 첫 동기화에서 채워진다)
        if (updated && deps.repo.setAlias) updated = await applyDefaultCatalogAlias({ setAlias: deps.repo.setAlias.bind(deps.repo) }, updated);
        // 경고가 없으면 종전과 같은 인자로 기록한다(색인 미사용 = 종전 동작)
        await (warning ? deps.repo.recordSyncResult(row.id, 'ok', null, warning) : deps.repo.recordSyncResult(row.id, 'ok', null)).catch((e) => logger.warn(`동기화 상태 기록 실패 (${row.id}):`, e));
        return { row: updated, snapshot, via };
    } catch (err) {
        const raw = err instanceof Error ? err.message : String(err);
        const reason = sanitizeSyncError(raw, token);
        await deps.repo.recordSyncResult(row.id, classifySyncError(raw), reason)
            .catch((e) => logger.warn(`동기화 상태 기록 실패 (${row.id}):`, e));
        if (err instanceof Error && token && err.message.includes(token)) err.message = reason;   // 던지는 사유에도 토큰을 남기지 않는다
        throw err;
    }
}

// ── 주기 동기화 ─────────────────────────────────────────────────────────────

interface FailureState { count: number; rateLimited: boolean }
const failures = new Map<string, FailureState>();
let timer: NodeJS.Timeout | null = null;
let running = false;

/** PURE: 다음 동기화까지 기다릴 시간 — 연속 실패면 간격 × 2^n(rate limit 은 × factor 더), 상한 */
export function effectiveIntervalMs(intervalMs: number, failure?: FailureState): number {
    if (!failure || failure.count <= 0) return intervalMs;
    const factor = Math.pow(2, failure.count) * (failure.rateLimited ? EXTENSION_CATALOG_SYNC_LIMITS.RATE_LIMIT_BACKOFF_FACTOR : 1);
    return Math.min(intervalMs * factor, Math.max(intervalMs, EXTENSION_CATALOG_SYNC_LIMITS.BACKOFF_MAX_MS));
}

/** PURE: 이 원본을 지금 동기화할 차례인가 — 마지막 시도(없으면 마지막 성공) 시각 + 유효 간격이 지났으면 */
export function isDue(row: Pick<ExtensionCatalogRow, 'last_sync_attempt_at' | 'last_synced_at'>, now: number, intervalMs: number, failure?: FailureState): boolean {
    const last = row.last_sync_attempt_at ?? row.last_synced_at;
    const lastMs = last ? new Date(last).getTime() : 0;
    return now - lastMs >= effectiveIntervalMs(intervalMs, failure);
}

/**
 * 주기 동기화 1회 — 반환은 시도한 원본 수. 꺼져 있으면 0(DB 조회 없음). 실패는 원본별로 삼킨다(다음 원본 계속).
 * rate limit 을 만나면 이번 tick 은 거기서 멈춘다(같은 IP 의 다른 원본도 같은 한도를 맞을 가능성이 높다).
 */
export async function runCatalogAutoSyncTick(deps: CatalogSyncDeps, now: number = Date.now()): Promise<number> {
    if (!EXTENSION_CATALOG_SYNC_SETTINGS.autoSyncEnabled) return 0;
    const intervalMs = EXTENSION_CATALOG_SYNC_SETTINGS.intervalMs;
    const due = (await deps.repo.listEnabled())
        .filter((r) => isDue(r, now, intervalMs, failures.get(r.id)))
        .slice(0, EXTENSION_CATALOG_SYNC_LIMITS.MAX_SOURCES_PER_TICK);
    let attempted = 0;
    for (const row of due) {
        attempted++;
        try {
            const { snapshot } = await syncCatalogSource(deps, row);
            failures.delete(row.id);
            logger.info(`카탈로그 주기 동기화: ${row.id} (${snapshot.plugins.length} plugins)`);
            void deps.service.translateCatalogSnapshot(snapshot, row.plugins)
                .then(() => deps.repo.updateSnapshot(row.id, snapshot))
                .catch((e) => logger.warn(`catalog 번역 실패 (동기화는 완료): ${e instanceof Error ? e.message : String(e)}`));
        } catch (err) {
            const raw = err instanceof Error ? err.message : String(err);
            const rateLimited = classifySyncError(raw) === 'rate_limited';
            const prev = failures.get(row.id);
            failures.set(row.id, { count: (prev?.count ?? 0) + 1, rateLimited });
            logger.warn(`카탈로그 주기 동기화 실패 (${row.id}, 연속 ${(prev?.count ?? 0) + 1}회): ${sanitizeSyncError(raw)}`);
            if (rateLimited) break;
        }
    }
    return attempted;
}

/** 기본 의존성 — 실제 저장소·설치 엔진 (동적 import: 부팅 시 무거운 모듈을 미리 끌어오지 않게) */
async function defaultDeps(): Promise<CatalogSyncDeps> {
    const { getPool } = await import('../../data/models/unified-database');
    const { ExtensionCatalogRepository } = await import('../../data/repositories/extension-catalog-repository');
    const { buildExtensionIngestService } = await import('./ingest-service-factory');
    return { repo: new ExtensionCatalogRepository(getPool()), service: await buildExtensionIngestService() };
}

/** 주기 동기화 타이머 시작 — 켜짐 여부는 매 tick 에 읽는다. 이미 돌고 있으면 무시 */
export function startCatalogAutoSync(depsFactory: () => Promise<CatalogSyncDeps> = defaultDeps): void {
    if (timer) return;
    timer = setInterval(() => {
        if (running || !EXTENSION_CATALOG_SYNC_SETTINGS.autoSyncEnabled) return;
        running = true;
        void depsFactory()
            .then((deps) => runCatalogAutoSyncTick(deps))
            .catch((e) => logger.warn('카탈로그 주기 동기화 tick 실패 (다음 tick 재시도):', e))
            .finally(() => { running = false; });
    }, EXTENSION_CATALOG_SYNC_LIMITS.TICK_MS);
    timer.unref?.();
}

export function stopCatalogAutoSync(): void {
    if (timer) { clearInterval(timer); timer = null; }
}

/** 테스트 전용 — 타이머·실패 횟수 초기화 */
export function resetCatalogAutoSyncState(): void {
    stopCatalogAutoSync();
    failures.clear();
    running = false;
}

/** 테스트·관측 — 타이머가 걸려 있는가 */
export function isCatalogAutoSyncRunning(): boolean {
    return timer !== null;
}
