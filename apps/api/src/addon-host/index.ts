/**
 * Add-on Host — Base 가 아는 유일한 확장 지점 (Add-on 전환 P1, 2026-09-18).
 *
 * 지금은 내장 팩(산업 에이전트·유틸리티 스킬)의 부팅 진입점을 맡는다. 켜진 팩은 `skills.json` 을 설치하고
 * (pack-skills.ts — 팩별 시더 코드 없음), 꺼진 팩은
 * 그 팩의 시스템 스킬을 보관해 주입을 멈춘다(다시 켜면 시더의 upsert 가 active 로 되돌린다).
 * 서버 기동을 막지 않는다 — 시더는 백그라운드, 실패는 로그만(fail-open).
 * 이후 단계에서 manifest 해석·설치 범위·번들 로더가 이 모듈 아래로 들어온다.
 * 경계 규칙은 `config/addon-boundary.ts`, 팩 구성은 `builtin-registry.ts`.
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
import {
    builtinAddonIds, enabledBuiltinAddons, invalidBuiltinAddons, isBuiltinAddonEnabled, listBuiltinAddonDefs, unknownDisabledIds,
    type BuiltinAddon,
} from './builtin-registry';

const logger = createLogger('AddonHost');

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
 * 켜진 내장 팩의 매니페스트를 검증한다 — 실패해도 팩은 계속 동작하고(fail-open) 경고만 남긴다.
 * 알아채는 방법: 부팅 로그의 `내장 팩 매니페스트` 경고, 그리고 `manifest.test.ts` 가 CI 에서 같은 검증을 한다.
 */
function verifyBuiltinManifests(): void {
    for (const reason of invalidBuiltinAddons()) logger.warn(`내장 add-on 매니페스트 오류 — 로드하지 않음: ${reason}`);
    for (const addon of enabledBuiltinAddons()) {
        if (!satisfiesOpenmakeRange(APP_VERSION, addon.manifest.requires.openmake)) {
            logger.warn(`내장 팩 매니페스트 '${addon.id}' 호환 범위 밖: requires ${addon.manifest.requires.openmake}, 현재 ${APP_VERSION}`);
            continue;
        }
        logger.info(`내장 팩 '${addon.id}' v${addon.manifest.version} 활성`);
    }
}

/**
 * 모델 요구(`requires.model`) 정적 대조 — 충족 후보를 안내하고, 없으면 명시적으로 경고한다.
 * 조용히 외부 모델로 넘어가지 않는다(폐쇄망 배포에서 그 대체는 존재하지 않는다).
 */
async function verifyAddonModelRequirements(): Promise<void> {
    const targets = enabledBuiltinAddons().filter(a => a.manifest.requires.model);
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
 * 켜진 add-on 의 전용 스키마 적용 — 매니페스트 `components.migrations` 를 선언한 add-on 만.
 * 코어 마이그레이션은 이미 부팅 초기에 끝났고, 여기는 add-on 네임스페이스(`addon:<id>:NNN`)다.
 * 실패한 add-on 은 로그만 남기고 나머지는 계속한다(fail-open) — 그 add-on 의 기능만 비게 된다.
 */
async function applyEnabledAddonMigrations(): Promise<void> {
    const { targets, denied } = selectMigrationTargets(enabledBuiltinAddons());
    for (const id of denied) logger.warn(`add-on '${id}' 마이그레이션 건너뜀 — 매니페스트에 '${ADDON_PERMISSIONS.DATABASE_ADDON}' 권한이 없습니다`);
    if (targets.length === 0) return;
    try {
        const { applyAddonMigrationsWithLock } = await import('../data/migrations/runner');
        const { getUnifiedDatabase } = await import('../data/models/unified-database');
        for (const r of await applyAddonMigrationsWithLock(getUnifiedDatabase().getPool(), targets)) {
            if (r.error) logger.error(`add-on '${r.id}' 마이그레이션 실패 — 해당 기능 비활성: ${r.error}`);
            else if (r.applied.length > 0) logger.info(`add-on '${r.id}' 마이그레이션 ${r.applied.length}건 적용: ${r.applied.join(', ')}`);
        }
    } catch (err) {
        logger.error('add-on 마이그레이션 실행 실패:', err);
    }
}

/**
 * 런타임 구현 add-on(매니페스트 `entry.runtime`)을 먼저 세운다 — 스킬·도구 런타임이 Base 포트에 꽂혀야
 * 뒤따르는 팩 설치와 채팅 경로가 의미를 갖는다. 하나가 실패해도 나머지는 계속 세우고(fail-open),
 * 꽂히지 않은 포트는 NULL 구현으로 남는다(그 기능만 비활성).
 */
async function startRuntimeAddons(): Promise<void> {
    for (const addon of enabledBuiltinAddons()) {
        const ref = addon.manifest.entry?.runtime;
        if (!ref) continue;
        try {
            await loadAddonEntry<() => Promise<void>>(addon, ref)();
        } catch (err) {
            logger.error(`add-on '${addon.id}' 런타임 등록 실패 — 해당 기능 비활성:`, err);
            await markAddonFailed(addon.id, err instanceof Error ? err.message : String(err));
        }
    }
}

/**
 * 발견된 내장 add-on 을 설치 표(`addon_installations`)에 반영한다 — 내장과 설치형이 같은 상태 모델을 쓴다.
 * **state 는 건드리지 않는다**: 관리자가 끈 add-on 이 재부팅으로 되살아나면 안 된다.
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

/** 런타임 등록이 실패한 add-on 을 failed 로 기록한다 — 관리자 화면이 사유를 보여 준다. */
async function markAddonFailed(addonId: string, reason: string): Promise<void> {
    try {
        const { getUnifiedDatabase } = await import('../data/models/unified-database');
        const { AddonStateRepository } = await import('../data/repositories/addon-state-repository');
        const { clearAddonStateCache } = await import('../services/addon/addon-state');
        await new AddonStateRepository(getUnifiedDatabase().getPool()).setState(addonId, 'failed', reason.slice(0, 2000));
        clearAddonStateCache();
    } catch { /* 기록 실패는 무시 — 로그가 이미 남았다 */ }
}

export async function startAddonHost(): Promise<void> {
    verifyBuiltinManifests();
    await syncAddonInstallations();
    await verifyAddonModelRequirements();

    const unknown = unknownDisabledIds();
    if (unknown.length > 0) {
        logger.warn(`ADDON_BUILTIN_DISABLED 에 알 수 없는 팩 id: ${unknown.join(', ')} (가능한 값: ${builtinAddonIds().join(', ')})`);
    }

    await applyEnabledAddonMigrations();
    await startRuntimeAddons();

    for (const addon of enabledBuiltinAddons()) {
        installBuiltinPack(addon.id).catch((err: unknown) => logger.error(`내장 팩 '${addon.id}' 설치 실패:`, err));
    }

    for (const addon of listBuiltinAddonDefs()) {
        if (isBuiltinAddonEnabled(addon.id)) continue;
        archiveDisabledAddonSkills(addon).catch((err: unknown) => logger.error(`내장 팩 '${addon.id}' 스킬 보관 실패:`, err));
    }
}
