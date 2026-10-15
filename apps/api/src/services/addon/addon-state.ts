/**
 * Add-on 상태 캐시 — "지금 이 add-on 이 켜져 있나" 의 단일 판정 (2026-09-19, S3).
 *
 * 켜짐 판정은 두 축의 AND 다:
 *   ① env `ADDON_BUILTIN_DISABLED` (비상 override — 배포 단위, 재시작 필요)
 *   ② DB `addon_installations.state` (관리자 토글 — 실시간, 이 캐시가 authority)
 *
 * ⚠️ **실시간으로 바뀌는 것과 아닌 것**: 라우트 노출·entitlement 는 요청마다 이 판정을 보므로 즉시 반영된다.
 * 반면 런타임 등록(`entry.runtime`)·내장 도구 기여·스킬 시드는 **부팅 시점**에 일어나므로 재시작이 필요하다
 * (관리자 화면이 그렇게 안내한다). 이 비대칭은 설계 선택이다 — 프로세스 내 코드 언로드는 열지 않았다.
 *
 * DB 를 읽을 수 없으면(부팅 초기·DB 장애) env 판정만으로 답한다(fail-open).
 *
 * @module services/addon/addon-state
 */
import { createLogger } from '../../utils/logger';
import { isBuiltinAddonEnabled } from '../../addon-host/builtin-registry';
import { ADDON_STATE_CACHE_TTL_MS } from '../../config/runtime-limits';
import type { AddonDesiredState, AddonFailureCode, AddonState } from '../../data/repositories/addon-state-repository';

const logger = createLogger('AddonState');

interface CacheEntry { states: Map<string, AddonState>; loadedAt: number }

let cache: CacheEntry | null = null;
/** 진행 중인 적재 — 거절하지 않고 실패를 값으로 돌려준다(fail-open·strict 두 경로가 같은 적재를 기다린다) */
let inflight: Promise<Error | null> | null = null;

async function loadStates(): Promise<void> {
    const { getUnifiedDatabase } = await import('../../data/models/unified-database');
    const { AddonStateRepository } = await import('../../data/repositories/addon-state-repository');
    const rows = await new AddonStateRepository(getUnifiedDatabase().getPool()).list();
    cache = { states: new Map(rows.map(r => [r.addon_id, r.state])), loadedAt: Date.now() };
}

function cacheFresh(): boolean {
    return cache !== null && Date.now() - cache.loadedAt < ADDON_STATE_CACHE_TTL_MS;
}

/** 적재를 한 번만 돌리고 결과(null = 성공, Error = 실패)를 돌려준다. 동시 호출은 같은 적재를 기다린다. */
function refreshStates(): Promise<Error | null> {
    inflight ??= loadStates()
        .then(() => null, (err: unknown) => (err instanceof Error ? err : new Error(String(err))))
        .finally(() => { inflight = null; });
    return inflight;
}

/** 캐시를 채운다(만료·미적재 시). 실패는 로그만 — 호출부는 env 판정으로 계속한다(fail-open). */
export async function ensureAddonStates(): Promise<void> {
    if (cacheFresh()) return;
    const err = await refreshStates();
    if (err) logger.debug(`add-on 상태 적재 실패(무시): ${err.message}`);
}

/**
 * `state` — 켜짐/꺼짐의 이유. env 차단은 `env_disabled`, 행 없음(미등록)은 기본 의도 `enabled`.
 * `failed`(부팅 실패)는 관리자 조치가 필요해 라우트가 꺼짐(404)과 구분해 503 `ADDON_FAILED` 로 알린다(설계 문서 8.3).
 */
export type AddonEnabledVerdict =
    | { known: true; enabled: boolean; state: AddonState | 'env_disabled' }
    | { known: false; reason: string };

/**
 * strict 켜짐 판정 — '조회 실패'를 '켜짐'으로 읽지 않는다(설계 문서 8.3). env 차단은 항상 안다.
 * DB 의도는 TTL 안의 캐시를 쓰고, 만료·미적재면 다시 읽는다. 읽기에 실패하면 `known:false` — 만료된 캐시로
 * 답하지 않는다(장애 동안 꺼진 기능이 열리는 것보다 503 이 낫다). 라우트 게이트·채팅 훅 게이트가 쓴다.
 * `isAddonEnabled()` 는 스킬 주입 필터의 fail-open 경로로 그대로 둔다.
 */
export async function readAddonEnabledStrict(addonId: string): Promise<AddonEnabledVerdict> {
    if (!isBuiltinAddonEnabled(addonId)) return { known: true, enabled: false, state: 'env_disabled' };
    if (!cacheFresh()) {
        const err = await refreshStates();
        if (err) return { known: false, reason: err.message };
    }
    const state = cachedAddonState(addonId) ?? 'enabled';
    return { known: true, enabled: state === 'enabled', state };
}

/**
 * strict 조회 — 오류를 삼키지 않는다(P01, 계획서 7.1). '행 없음'(= 미등록, 기본 의도 enabled)과 '조회 실패'(`known:false`)를
 * 구분해 돌려준다. capability 실행 승인처럼 **fail-closed 여야 하는 경로**가 쓴다 — 기존 `ensureAddonStates()` 는
 * 라우트 노출·사용권의 fail-open 경로로 그대로 둔다(한 번에 확산하지 않는다).
 */
export type StrictAddonState =
    | { known: true; registered: boolean; state: AddonState; desiredState: AddonDesiredState; stateRevision: number; lastFailureCode: AddonFailureCode | null }
    | { known: false; reason: string };

export async function readAddonStateStrict(addonId: string): Promise<StrictAddonState> {
    try {
        const { getUnifiedDatabase } = await import('../../data/models/unified-database');
        const { AddonStateRepository } = await import('../../data/repositories/addon-state-repository');
        const row = await new AddonStateRepository(getUnifiedDatabase().getPool()).get(addonId);
        if (!row) return { known: true, registered: false, state: 'enabled', desiredState: 'enabled', stateRevision: 0, lastFailureCode: null };
        return { known: true, registered: true, state: row.state, desiredState: row.desired_state, stateRevision: row.state_revision, lastFailureCode: row.last_failure_code };
    } catch (err) {
        return { known: false, reason: err instanceof Error ? err.message : String(err) };
    }
}

/**
 * 쓰기 직후 호출 — 다음 조회가 DB 를 다시 읽는다. 마지막으로 알던 값은 남긴다: 동기 판정(`isAddonEnabledSync`)이
 * 다음 적재 전까지 '모름 = 켜짐'으로 떨어져 이미 꺼둔 add-on 의 훅이 되살아나지 않게 한다.
 */
export function clearAddonStateCache(): void {
    if (cache) cache = { states: cache.states, loadedAt: 0 };
}

/** 테스트 전용 — 캐시를 완전히 비운다(첫 적재 전 상태). */
export function __resetAddonStateCacheForTest(): void {
    cache = null;
}

/** 캐시에 적재된 상태(없으면 undefined = DB 를 아직 못 읽었거나 미등록). */
export function cachedAddonState(addonId: string): AddonState | undefined {
    return cache?.states.get(addonId);
}

/**
 * 동기 판정 — 캐시에 있는 값만 본다(만료돼도 마지막 값). 채팅은 턴 시작(`runMessagePipeline`)에서, 라우트는 게이트에서
 * `ensureAddonStates()` 를 먼저 await 해 이 턴의 캐시를 TTL 안으로 맞춘다. 첫 적재 전에는 env 판정만 쓴다(부팅 직후 fail-open).
 */
export function isAddonEnabledSync(addonId: string): boolean {
    if (!isBuiltinAddonEnabled(addonId)) return false;
    const state = cachedAddonState(addonId);
    return state === undefined ? true : state === 'enabled';
}

/** 비동기 판정 — 캐시를 보장한 뒤 답한다. */
export async function isAddonEnabled(addonId: string): Promise<boolean> {
    await ensureAddonStates();
    return isAddonEnabledSync(addonId);
}

/**
 * 설치형 확장(Git·ZIP·로컬·마켓)을 add-on 설치 표에 기록한다 — **내장과 같은 상태 모델**을 쓰기 위한 1단계
 * (arch_plan S3 "설치 이력·상태 모델의 공유"). id 는 `ext:<extensionId>` 로 내장 add-on id 와 겹치지 않게 둔다.
 *
 * 실패는 삼킨다 — 설치 자체는 이미 성공했고, 이 기록은 관리 화면의 가시성용이다.
 */
export async function recordExtensionInstallation(input: {
    extensionId: string; name: string; version: string; source: 'git' | 'zip' | 'local' | 'marketplace';
}): Promise<void> {
    try {
        const { getUnifiedDatabase } = await import('../../data/models/unified-database');
        const { AddonStateRepository } = await import('../../data/repositories/addon-state-repository');
        await new AddonStateRepository(getUnifiedDatabase().getPool()).upsertDiscovered({
            addonId: `ext:${input.extensionId}`,
            name: input.name,
            version: input.version,
            kind: 'extension',
            source: input.source,
        });
        clearAddonStateCache();
    } catch (err) {
        logger.debug(`확장 설치 기록 실패(무시): ${err instanceof Error ? err.message : String(err)}`);
    }
}

/**
 * 확장 제거를 상태 표에 반영한다 — 행을 지운다(상태 4종에 "removed" 는 없다).
 * (2026-09-20: 제거해도 `ext:<id>` 행이 enabled 로 남아 관리 화면이 지운 팩을 계속 보여 주던 누락)
 */
export async function removeExtensionInstallation(extensionId: string): Promise<void> {
    try {
        const { getUnifiedDatabase } = await import('../../data/models/unified-database');
        await getUnifiedDatabase().getPool().query('DELETE FROM addon_installations WHERE addon_id = $1', [`ext:${extensionId}`]);
        clearAddonStateCache();
    } catch (err) {
        logger.debug(`확장 제거 기록 실패(무시): ${err instanceof Error ? err.message : String(err)}`);
    }
}
