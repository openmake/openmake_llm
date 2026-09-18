/**
 * Add-on Host — Base 가 아는 유일한 확장 지점 (Add-on 전환 P1, 2026-09-18).
 *
 * 지금은 내장 팩(산업 에이전트·유틸리티 스킬)의 부팅 진입점을 맡는다. 켜진 팩은 시드하고, 꺼진 팩은
 * 그 팩의 시스템 스킬을 보관해 주입을 멈춘다(다시 켜면 시더의 upsert 가 active 로 되돌린다).
 * 서버 기동을 막지 않는다 — 시더는 백그라운드, 실패는 로그만(fail-open).
 * 이후 단계에서 manifest 해석·설치 범위·번들 로더가 이 모듈 아래로 들어온다.
 * 경계 규칙은 `config/addon-boundary.ts`, 팩 구성은 `builtin-registry.ts`.
 *
 * @module addon-host
 */
import * as fs from 'fs';
import * as path from 'path';
import { createLogger } from '../utils/logger';
import { APP_VERSION } from '../config/constants';
import { addonManifestSchema, satisfiesOpenmakeRange } from './manifest';
import {
    BUILTIN_ADDON_IDS, BUILTIN_ADDON_SKILL_SOURCE_PATH, builtinAddonDir, isBuiltinAddonEnabled, unknownDisabledIds,
    type BuiltinAddonId,
} from './builtin-registry';

const logger = createLogger('AddonHost');

async function archiveDisabledAddonSkills(id: BuiltinAddonId): Promise<void> {
    const { getUnifiedDatabase } = await import('../data/models/unified-database');
    const { SkillRepository } = await import('../data/repositories/skill-repository');
    const archived = await new SkillRepository(getUnifiedDatabase().getPool())
        .archiveSystemSkillsBySourcePath(BUILTIN_ADDON_SKILL_SOURCE_PATH[id]);
    logger.info(`내장 팩 '${id}' 꺼짐 — 시스템 스킬 ${archived}개 보관`);
}

/**
 * 켜진 내장 팩의 매니페스트를 검증한다 — 실패해도 팩은 계속 동작하고(fail-open) 경고만 남긴다.
 * 알아채는 방법: 부팅 로그의 `내장 팩 매니페스트` 경고, 그리고 `manifest.test.ts` 가 CI 에서 같은 검증을 한다.
 */
function verifyBuiltinManifests(): void {
    for (const id of BUILTIN_ADDON_IDS) {
        if (!isBuiltinAddonEnabled(id)) continue;
        try {
            const manifest = addonManifestSchema.parse(JSON.parse(fs.readFileSync(path.join(builtinAddonDir(id), 'openmake-addon.json'), 'utf-8')));
            if (!satisfiesOpenmakeRange(APP_VERSION, manifest.requires.openmake)) {
                logger.warn(`내장 팩 매니페스트 '${id}' 호환 범위 밖: requires ${manifest.requires.openmake}, 현재 ${APP_VERSION}`);
                continue;
            }
            logger.info(`내장 팩 '${id}' v${manifest.version} 활성`);
        } catch (err) {
            logger.warn(`내장 팩 매니페스트 '${id}' 검증 실패:`, err);
        }
    }
}

export async function startAddonHost(): Promise<void> {
    verifyBuiltinManifests();

    const unknown = unknownDisabledIds();
    if (unknown.length > 0) {
        logger.warn(`ADDON_BUILTIN_DISABLED 에 알 수 없는 팩 id: ${unknown.join(', ')} (가능한 값: ${BUILTIN_ADDON_IDS.join(', ')})`);
    }

    // 산업 스킬 시더는 Base 스킬(general·author-guide)도 함께 시드한다 — 팩이 꺼져 있으면 산업 데이터가
    // 비어 그 부분만 건너뛴다(agents/types.ts getIndustryAgentsData).
    try {
        const { seedAgentSkills } = await import('../agents/skill-seeder');
        seedAgentSkills().catch((err: unknown) => logger.error('스킬 시딩 실패:', err));
    } catch (err) {
        logger.error('스킬 시더 로드 실패:', err);
    }

    if (isBuiltinAddonEnabled('utility-pack')) {
        try {
            const { seedUtilitySkills } = await import('../agents/utility-skills-seeder');
            seedUtilitySkills().catch((err: unknown) => logger.error('유틸리티 스킬 시딩 실패:', err));
        } catch (err) {
            logger.error('유틸리티 스킬 시더 로드 실패:', err);
        }
    }

    for (const id of BUILTIN_ADDON_IDS) {
        if (isBuiltinAddonEnabled(id)) continue;
        archiveDisabledAddonSkills(id).catch((err: unknown) => logger.error(`내장 팩 '${id}' 스킬 보관 실패:`, err));
    }
}
