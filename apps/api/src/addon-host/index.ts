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
import { createLogger } from '../utils/logger';
import { APP_VERSION } from '../config/constants';
import { satisfiesOpenmakeRange } from './manifest';
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

export async function startAddonHost(): Promise<void> {
    verifyBuiltinManifests();

    const unknown = unknownDisabledIds();
    if (unknown.length > 0) {
        logger.warn(`ADDON_BUILTIN_DISABLED 에 알 수 없는 팩 id: ${unknown.join(', ')} (가능한 값: ${builtinAddonIds().join(', ')})`);
    }

    // Base 스킬(general·author-guide) — 팩 구성과 무관하게 항상 시드
    try {
        const { seedBaseSkills } = await import('../agents/skill-seeder');
        seedBaseSkills().catch((err: unknown) => logger.error('Base 스킬 시딩 실패:', err));
    } catch (err) {
        logger.error('Base 스킬 시더 로드 실패:', err);
    }

    for (const addon of enabledBuiltinAddons()) {
        installBuiltinPack(addon.id).catch((err: unknown) => logger.error(`내장 팩 '${addon.id}' 설치 실패:`, err));
    }

    for (const addon of listBuiltinAddonDefs()) {
        if (isBuiltinAddonEnabled(addon.id)) continue;
        archiveDisabledAddonSkills(addon).catch((err: unknown) => logger.error(`내장 팩 '${addon.id}' 스킬 보관 실패:`, err));
    }
}
