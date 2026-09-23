/**
 * Add-on Host — Base 가 아는 유일한 확장 지점 (Add-on 전환 P1, 2026-09-18 → 부팅 절차 P01, 2026-09-23).
 *
 * 부팅 절차(계획서 7.1)를 단계별 결과로 돌린다:
 *   ① 매니페스트 발견·strict 검증 → ② 앱 버전 호환 검증 → ③ env + DB 의도(`desired_state`)로 대상 확정 →
 *   ④ 허용된 add-on 의 migration → ⑤ 성공한 add-on 만 런타임 진입점(`entry.runtime`) 호출 →
 *   ⑥ 팩 설치(스킬·카탈로그) → ⑦ 대상 밖 add-on 의 시스템 스킬 보관.
 * **실패한 add-on 의 후속 단계는 명시적으로 차단한다** — 버전 불일치·migration 실패는 그 add-on 의 런타임을 시작하지
 * 않고 `addon_installations` 에 `last_failure_code` 로 남긴다(관리자 의도 `desired_state` 는 건드리지 않는다).
 * 다른 add-on 은 계속 시작한다. 서버 기동 자체는 막지 않는다.
 * 프로세스별 런타임 상태는 `activation.ts`(메모리) 가 들고 관리 API 가 DB 의도와 함께 보여 준다.
 *
 * ⚠️ 이 절차의 대상 판정(env ∧ DB 의도)은 부팅 시점 단계(migration·런타임·팩 설치)에만 적용한다. 모듈 로드 시점에
 * 읽히는 콘텐츠(에이전트 정의·기여·채팅 통합)는 종전대로 env 판정이고, 요청 경로는 `addon-guard` 의 실시간 상태 판정이 막는다.
 *
 * @module addon-host
 */
import * as path from 'path';
import { createLogger } from '../utils/logger';
import { APP_VERSION } from '../config/constants';
import { satisfiesOpenmakeRange } from './manifest';
import { ADDON_PERMISSIONS, hasAddonPermission } from '../config/addon-permissions';
import { loadAddonEntry } from './entry-loader';
import { installPackCatalog } from './pack-catalog';
import { installPackSkills } from './pack-skills';
import { setAddonRuntimeStatus } from './activation';
import type { AddonFailureCode, AddonInstallationRow } from '../data/repositories/addon-state-repository';
import {
    builtinAddonIds, enabledBuiltinAddons, invalidBuiltinAddons, listBuiltinAddonDefs, unknownDisabledIds,
    type BuiltinAddon,
} from './builtin-registry';

const logger = createLogger('AddonHost');

/** 부팅 한 번의 add-on 별 결과 — 테스트와 부팅 로그가 읽는다 */
export interface AddonBootResult {
    id: string;
    stage: 'excluded' | 'version_mismatch' | 'migration_failed' | 'runtime_failed' | 'ready';
    reason?: string;
}

async function installBuiltinPack(id: string): Promise<void> {
    const { getUnifiedDatabase } = await import('../data/models/unified-database');
    const { SkillRepository } = await import('../data/repositories/skill-repository');
    const { installed, failed } = await installPackSkills(id, new SkillRepository(getUnifiedDatabase().getPool()));
    if (installed > 0 || failed.length > 0) logger.info(`내장 팩 '${id}' 스킬 설치: ${installed}개 성공, ${failed.length}개 실패`);
    for (const reason of failed) logger.error(`내장 팩 '${id}' 스킬 설치 실패 — ${reason}`);

    const { AddonInstallRepository } = await import('../data/repositories/addon-install-repository');
    const catalog = await installPackCatalog(id, new AddonInstallRepository(getUnifiedDatabase().getPool()));
    if (catalog.installed.length > 0) logger.info(`내장 팩 '${id}' 카탈로그 템플릿 신규 설치: ${catalog.installed.join(', ')}`);
    for (const reason of catalog.failed) logger.error(`내장 팩 '${id}' 카탈로그 설치 실패 — ${reason}`);
}

async function archiveDisabledAddonSkills(addon: BuiltinAddon): Promise<void> {
    const id = addon.id;
    const sourcePathLike = addon.manifest.skillSourcePath;
    if (!sourcePathLike) return; // 스킬을 싣지 않는 add-on (통합 기능)
    const { getUnifiedDatabase } = await import('../data/models/unified-database');
    const { SkillRepository } = await import('../data/repositories/skill-repository');
    const archived = await new SkillRepository(getUnifiedDatabase().getPool()).archiveSystemSkillsBySourcePath(sourcePathLike);
    logger.info(`내장 팩 '${id}' 꺼짐 — 시스템 스킬 ${archived}개 보관`);
}

/**
 * 모델 요구(`requires.model`) 정적 대조 — 충족 후보를 안내하고, 없으면 명시적으로 경고한다.
 * 조용히 외부 모델로 넘어가지 않는다(폐쇄망 배포에서 그 대체는 존재하지 않는다).
 */
async function verifyAddonModelRequirements(addons: readonly BuiltinAddon[]): Promise<void> {
    const targets = addons.filter(a => a.manifest.requires.model);
    if (targets.length === 0) return;
    try {
        const { availableChatModelFacts, checkModelRequirement } = await import('../services/addon/model-requirements');
        const models = await availableChatModelFacts();
        for (const addon of targets) {
            const verdict = checkModelRequirement(addon.manifest.requires.model, models);
            if (verdict.ok) logger.info(`add-on '${addon.id}' 모델 요구 충족 — 후보 ${verdict.satisfiedBy.length}개: ${verdict.satisfiedBy.slice(0, 5).join(', ')}`);
            else logger.warn(`add-on '${addon.id}' 모델 요구 미충족 — ${verdict.reason}`);
        }
    } catch (err) {
        logger.debug('모델 요구 대조 실패(무시):', err);
    }
}

/**
 * PURE: 스키마를 적용할 add-on 을 고른다 — `components.migrations` 를 선언했고 **`database:addon` 권한도 있는** 것만.
 * 권한 없이 선언한 add-on 은 `denied` 로 돌려 호출부가 경고를 남긴다(선언만으로 DB 를 바꾸지 못한다).
 */
export function selectMigrationTargets(addons: readonly BuiltinAddon[]): { targets: Array<{ id: string; dir: string }>; denied: string[] } {
    const declared = addons.filter(a => a.manifest.components.migrations);
    const allowed = declared.filter(a => hasAddonPermission(a.manifest.permissions, ADDON_PERMISSIONS.DATABASE_ADDON));
    return {
        targets: allowed.map(a => ({ id: a.id, dir: path.resolve(a.dir, a.manifest.components.migrations!) })),
        denied: declared.filter(a => !allowed.includes(a)).map(a => a.id),
    };
}

/**
 * 부팅 절차가 의존하는 외부 효과 — 테스트가 통째로 주입한다(DB·require 없이 절차만 검증).
 * 운영 구현은 `defaultBootDeps()`.
 */
export interface AddonBootDeps {
    /** DB 의도 조회 — 실패는 throw (호출부가 env 판정으로 계속하며 경고) */
    readInstallations(): Promise<Map<string, Pick<AddonInstallationRow, 'desired_state' | 'state'>>>;
    applyMigrations(targets: Array<{ id: string; dir: string }>): Promise<Array<{ id: string; applied: string[]; error?: string }>>;
    startRuntime(addon: BuiltinAddon, ref: string): Promise<void>;
    markFailed(addonId: string, code: AddonFailureCode, reason: string): Promise<void>;
    markSucceeded(addonId: string): Promise<void>;
    appVersion: string;
}

function defaultBootDeps(): AddonBootDeps {
    const repo = async () => {
        const { getUnifiedDatabase } = await import('../data/models/unified-database');
        const { AddonStateRepository } = await import('../data/repositories/addon-state-repository');
        return new AddonStateRepository(getUnifiedDatabase().getPool());
    };
    const invalidate = async () => { (await import('../services/addon/addon-state')).clearAddonStateCache(); };
    return {
        appVersion: APP_VERSION,
        async readInstallations() {
            const rows = await (await repo()).list();
            return new Map(rows.map(r => [r.addon_id, { desired_state: r.desired_state, state: r.state }]));
        },
        async applyMigrations(targets) {
            const { applyAddonMigrationsWithLock } = await import('../data/migrations/runner');
            const { getUnifiedDatabase } = await import('../data/models/unified-database');
            return applyAddonMigrationsWithLock(getUnifiedDatabase().getPool(), targets);
        },
        async startRuntime(addon, ref) {
            await loadAddonEntry<() => Promise<void>>(addon, ref)();
        },
        async markFailed(addonId, code, reason) {
            try { await (await repo()).markBootFailure(addonId, code, reason); await invalidate(); } catch { /* 로그가 이미 남았다 */ }
        },
        async markSucceeded(addonId) {
            try { await (await repo()).markBootSucceeded(addonId); await invalidate(); } catch { /* 기록 실패는 무시 */ }
        },
    };
}

/**
 * ①~⑤ — 대상 확정부터 런타임 시작까지. 순수 절차라 deps 를 주입해 테스트한다.
 * 반환은 add-on 별 최종 단계(팩 설치·보관은 호출부가 이 결과로 나눈다).
 */
export async function bootAddons(candidates: readonly BuiltinAddon[], deps: AddonBootDeps): Promise<AddonBootResult[]> {
    const results = new Map<string, AddonBootResult>();
    const fail = async (addon: BuiltinAddon, stage: Exclude<AddonBootResult['stage'], 'ready' | 'excluded'>, code: AddonFailureCode, reason: string) => {
        results.set(addon.id, { id: addon.id, stage, reason });
        setAddonRuntimeStatus(addon.id, 'failed', { code, reason });
        await deps.markFailed(addon.id, code, reason);
    };

    // ③ env(후보 목록) ∧ DB 의도 — 조회 실패는 경고 후 env 판정만으로 계속한다(기존 팩의 부팅을 DB 장애가 막지 않는다)
    let desired: Map<string, Pick<AddonInstallationRow, 'desired_state' | 'state'>> | null = null;
    try { desired = await deps.readInstallations(); } catch (err) {
        logger.warn(`add-on 의도 조회 실패 — env 판정만으로 부팅: ${err instanceof Error ? err.message : String(err)}`);
    }
    let active: BuiltinAddon[] = [];
    for (const addon of candidates) {
        const row = desired?.get(addon.id);
        if (row && row.desired_state !== 'enabled') {
            results.set(addon.id, { id: addon.id, stage: 'excluded', reason: `관리자 의도 ${row.desired_state}` });
            logger.info(`add-on '${addon.id}' 관리자 의도 ${row.desired_state} — 부팅 대상에서 제외`);
            continue;
        }
        // ② 버전 불일치는 경고 후 계속 실행하지 않고 그 add-on 을 제외한다(계획서 7.4)
        if (!satisfiesOpenmakeRange(deps.appVersion, addon.manifest.requires.openmake)) {
            const reason = `requires ${addon.manifest.requires.openmake}, 현재 ${deps.appVersion}`;
            logger.warn(`내장 add-on '${addon.id}' 호환 범위 밖 — 제외: ${reason}`);
            await fail(addon, 'version_mismatch', 'version_mismatch', reason);
            continue;
        }
        active.push(addon);
    }

    // ④ migration — 실패한 add-on 은 런타임을 시작하지 않는다(그 테이블을 전제한 코드가 부분 서비스를 만들지 않게)
    const { targets, denied } = selectMigrationTargets(active);
    for (const id of denied) logger.warn(`add-on '${id}' 마이그레이션 건너뜀 — 매니페스트에 '${ADDON_PERMISSIONS.DATABASE_ADDON}' 권한이 없습니다`);
    if (targets.length > 0) {
        let outcomes: Array<{ id: string; applied: string[]; error?: string }>;
        try { outcomes = await deps.applyMigrations(targets); } catch (err) {
            const reason = err instanceof Error ? err.message : String(err);
            logger.error(`add-on 마이그레이션 실행 실패 — 대상 add-on 전부 제외: ${reason}`);
            outcomes = targets.map(t => ({ id: t.id, applied: [], error: reason }));
        }
        for (const r of outcomes) {
            const addon = active.find(a => a.id === r.id);
            if (!addon) continue;
            if (r.error) {
                logger.error(`add-on '${r.id}' 마이그레이션 실패 — 런타임 시작 차단: ${r.error}`);
                await fail(addon, 'migration_failed', 'migration_failed', r.error);
            } else if (r.applied.length > 0) logger.info(`add-on '${r.id}' 마이그레이션 ${r.applied.length}건 적용: ${r.applied.join(', ')}`);
        }
        active = active.filter(a => !results.has(a.id));
    }

    // ⑤ 런타임 진입점 — 등록 중(registering) 표시 후 ready/failed. 하나가 실패해도 나머지는 계속 세운다.
    for (const addon of active) {
        const ref = addon.manifest.entry?.runtime;
        if (ref) {
            setAddonRuntimeStatus(addon.id, 'registering');
            try {
                await deps.startRuntime(addon, ref);
            } catch (err) {
                const reason = err instanceof Error ? err.message : String(err);
                logger.error(`add-on '${addon.id}' 런타임 등록 실패 — 해당 기능 비활성: ${reason}`);
                await fail(addon, 'runtime_failed', 'runtime_failed', reason);
                continue;
            }
        }
        setAddonRuntimeStatus(addon.id, 'ready');
        results.set(addon.id, { id: addon.id, stage: 'ready' });
        await deps.markSucceeded(addon.id);
        logger.info(`내장 add-on '${addon.id}' v${addon.manifest.version} 활성`);
    }
    return candidates.map(a => results.get(a.id) ?? { id: a.id, stage: 'excluded' });
}

/**
 * 발견된 내장 add-on 을 설치 표(`addon_installations`)에 반영한다 — 내장과 설치형이 같은 상태 모델을 쓴다.
 * **state·desired_state 는 건드리지 않는다**: 관리자가 끈 add-on 이 재부팅으로 되살아나면 안 된다.
 */
async function syncAddonInstallations(): Promise<void> {
    try {
        const { getUnifiedDatabase } = await import('../data/models/unified-database');
        const { AddonStateRepository } = await import('../data/repositories/addon-state-repository');
        const { clearAddonStateCache } = await import('../services/addon/addon-state');
        const repo = new AddonStateRepository(getUnifiedDatabase().getPool());
        for (const addon of listBuiltinAddonDefs()) {
            await repo.upsertDiscovered({
                addonId: addon.id,
                name: addon.manifest.name,
                version: addon.manifest.version,
                kind: addon.manifest.kind ?? 'content',
                source: 'builtin',
                entitlementSku: addon.manifest.entitlement?.sku ?? null,
            });
        }
        clearAddonStateCache();
    } catch (err) {
        logger.error('add-on 설치 표 동기화 실패 (env 판정으로 계속):', err);
    }
}

export async function startAddonHost(deps: AddonBootDeps = defaultBootDeps()): Promise<AddonBootResult[]> {
    // ① 매니페스트 오류는 발견에서 이미 빠져 있다 — 사유를 부팅 로그로 알린다(`manifest.test.ts` 가 CI 에서 같은 검증)
    for (const reason of invalidBuiltinAddons()) logger.warn(`내장 add-on 매니페스트 오류 — 로드하지 않음: ${reason}`);
    const unknown = unknownDisabledIds();
    if (unknown.length > 0) {
        logger.warn(`ADDON_BUILTIN_DISABLED 에 알 수 없는 팩 id: ${unknown.join(', ')} (가능한 값: ${builtinAddonIds().join(', ')})`);
    }
    await syncAddonInstallations();

    const results = await bootAddons(enabledBuiltinAddons(), deps);
    const ready = new Set(results.filter(r => r.stage === 'ready').map(r => r.id));
    const readyAddons = listBuiltinAddonDefs().filter(a => ready.has(a.id));
    await verifyAddonModelRequirements(readyAddons);

    // ⑥ 팩 설치는 준비된 add-on 만 — 백그라운드, 실패는 로그(fail-open)
    for (const addon of readyAddons) {
        installBuiltinPack(addon.id).catch((err: unknown) => logger.error(`내장 팩 '${addon.id}' 설치 실패:`, err));
    }
    // ⑦ 대상 밖(env 꺼짐·의도 disabled·실패) add-on 의 시스템 스킬 보관 — 다시 켜면 시더의 upsert 가 active 로 되돌린다
    for (const addon of listBuiltinAddonDefs()) {
        if (ready.has(addon.id)) continue;
        archiveDisabledAddonSkills(addon).catch((err: unknown) => logger.error(`내장 팩 '${addon.id}' 스킬 보관 실패:`, err));
    }
    return results;
}
