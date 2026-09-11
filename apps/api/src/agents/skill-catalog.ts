/**
 * load_skill 카탈로그 — 설정·직렬화·상한 경고.
 * skill-manager.ts 가 Gate 3(600줄)에 닿아 분리했다 (2026-09-11). 조회는 SkillManager.buildSkillCatalog 가 한다.
 */
import type { AgentSkill, SkillSearchResult } from '../data/repositories/skill-repository';
import { createLogger } from '../utils/logger';

const logger = createLogger('SkillCatalog');

/** 카탈로그/선택 조회 상한 — env override (No-Hardcoding). searchSkills 가 200 으로 클램프한다. */
export const SKILL_CATALOG_MAX_ITEMS = Number(process.env.SKILL_CATALOG_MAX_ITEMS) || 200;
const SKILL_CATALOG_DESC_MAX = Number(process.env.SKILL_CATALOG_DESC_MAX) || 120;
/** 페르소나 스킬("○○ 전문 스킬")을 카탈로그·load_skill 대상에서 제외 — 기본 on, 'false' 면 종전 동작(롤백용). */
export const SKILL_CATALOG_EXCLUDE_PERSONAS = process.env.SKILL_CATALOG_EXCLUDE_PERSONAS !== 'false';

/** 상한 초과 경고는 대상 수가 같으면 한 번만 (매 턴 반복 방지) */
const truncationWarned = new Set<number>();

/** 상한을 넘은 스킬은 이름순 뒤쪽부터 조용히 빠진다 — 알아챌 수 있게 경고 (2026-09-11: 200 한도에 199 였다). */
export function warnIfCatalogTruncated(result: SkillSearchResult): void {
    if (result.total <= result.skills.length || truncationWarned.has(result.total)) return;
    truncationWarned.add(result.total);
    logger.warn(`스킬 카탈로그 상한(${result.limit}) 초과 — 대상 ${result.total}개 중 ${result.total - result.skills.length}개가 이름순으로 빠짐. 스킬을 정리하거나 SKILL_CATALOG_MAX_ITEMS(최대 200) 조정`);
}

/** active 스킬을 "- 이름: 설명" 한 줄씩 직렬화 — excludeIds(이미 주입된 바인딩 스킬)는 뺀다(dedup). */
export function formatSkillCatalog(skills: AgentSkill[], excludeIds?: ReadonlySet<string>): { catalog: string; count: number } {
    const lines: string[] = [];
    for (const s of skills) {
        if (excludeIds?.has(s.id)) continue;
        const safeName = s.name.replace(/[<>"&]/g, '');
        const desc = (s.description ?? '').replace(/\s+/g, ' ').trim().slice(0, SKILL_CATALOG_DESC_MAX);
        lines.push(desc ? `- ${safeName}: ${desc}` : `- ${safeName}`);
    }
    return { catalog: lines.join('\n'), count: lines.length };
}
