/**
 * 팩 스킬의 사용권 필터 — 주입 후보에서 사용권 없는 add-on 의 스킬을 걸러 낸다 (2026-09-19, S3).
 *
 * `agent_skills.addon_id` 가 있는 행(= 팩 스킬)만 대상이다. Base 스킬(NULL)은 그대로 남고,
 * 판정 실패는 주입을 유지한다(fail-open) — 정책 조회 장애가 기본 동작을 바꾸지 않는다.
 *
 * @module addons/skill-runtime/skill-entitlement-filter
 */
import { createLogger } from '../../utils/logger';

const logger = createLogger('SkillEntitlement');

/** 사용권 판정에 필요한 최소 모양 — SkillManager 의 매니페스트 행이 만족한다. */
interface AddonOwned { addon_id: string | null }

export async function filterByAddonEntitlement<T extends AddonOwned>(rows: T[], userId?: string): Promise<T[]> {
    const addonIds = [...new Set(rows.map(r => r.addon_id).filter((x): x is string => !!x))];
    if (addonIds.length === 0) return rows;
    try {
        const { entitledAddonIds } = await import('../../services/addon/entitlement');
        const allowed = await entitledAddonIds(addonIds, userId);
        const kept = rows.filter(r => !r.addon_id || allowed.has(r.addon_id));
        if (kept.length !== rows.length) logger.debug(`스킬 사용권 필터: ${rows.length} → ${kept.length} (user=${userId ?? '-'})`);
        return kept;
    } catch (e) {
        logger.debug('스킬 사용권 판정 실패 — 주입 유지(fail-open)', e);
        return rows;
    }
}
