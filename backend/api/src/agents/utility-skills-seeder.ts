/**
 * ============================================================
 * Utility Skills Seeder - 실용 유틸리티 스킬 자동 등록
 * ============================================================
 *
 * 서버 시작 시 40개의 범용 실용 스킬을 DB에 자동 등록(upsert)합니다.
 * industry-agents 기반 시스템 스킬과 별도로, 사용자가 일상적으로
 * 활용하는 실무 유틸리티 스킬을 제공합니다.
 *
 * 스킬 데이터:
 * - utility-skills-data-a.ts: general, coding, writing, analysis
 * - utility-skills-data-b.ts: creative, education, business, science
 *
 * @module agents/utility-skills-seeder
 */

import { createLogger } from '../utils/logger';
import { UTILITY_SKILLS_A } from './utility-skills-data-a';
import { UTILITY_SKILLS_B } from './utility-skills-data-b';

const logger = createLogger('UtilitySkillSeeder');

const UTILITY_SKILLS = [...UTILITY_SKILLS_A, ...UTILITY_SKILLS_B];

// ========================================
// 시더 메인 로직
// ========================================

export async function seedUtilitySkills(): Promise<void> {
    logger.info('유틸리티 스킬 시딩 시작...');

    try {
        const { getUnifiedDatabase } = await import('../data/models/unified-database');
        const { SkillRepository } = await import('../data/repositories/skill-repository');

        const pool = getUnifiedDatabase().getPool();
        const repo = new SkillRepository(pool);

        let seededCount = 0;
        let errorCount = 0;

        for (const skill of UTILITY_SKILLS) {
            try {
                const skillId = `utility-skill-${skill.id}`;

                await repo.upsertSystemSkill(skillId, {
                    name: skill.name,
                    description: skill.description,
                    content: skill.content,
                    category: skill.category,
                    isPublic: true,
                    sourcePath: `agents/utility-skills/${skill.category}/${skill.id}.md`,
                });

                seededCount++;
            } catch (err) {
                logger.error(`유틸리티 스킬 시딩 실패: ${skill.id}`, err);
                errorCount++;
            }
        }

        logger.info(`유틸리티 스킬 시딩 완료: ${seededCount}개 성공, ${errorCount}개 실패`);
    } catch (err) {
        logger.error('유틸리티 스킬 시딩 초기화 실패:', err);
    }
}
