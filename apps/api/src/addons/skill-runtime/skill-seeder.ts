/**
 * Base 스킬 시더 — 팩과 무관하게 항상 있어야 하는 시스템 스킬 (general 에이전트 · skill-author-guide).
 *
 * 산업·유틸리티 스킬은 여기서 만들지 않는다 — 내장 팩의 `skills.json` 을 addon-host 가 설치한다
 * (addon-host/pack-skills.ts, 2026-09-19 이전). 멱등 upsert, 실패는 서버 시작을 막지 않는다.
 *
 * @module agents/skill-seeder
 */

import { createLogger } from '../../utils/logger';
import type { SkillRepository } from '../../data/repositories/skill-repository';
import { GENERAL_SYSTEM_SKILL_NAME } from '../../agents/system-skill-names';
import { GENERAL_AGENT_SKILL_CONTENT, SKILL_AUTHOR_GUIDE_CONTENT } from './prompts';

const logger = createLogger('SkillSeeder');

/**
 * general 에이전트 스킬과 skill-author-guide 를 DB 에 upsert 하고 general 에 배정한다.
 */
export async function seedBaseSkills(): Promise<void> {
    logger.info('Base 스킬 시딩 시작...');

    try {
        // 지연 로딩: 순환 참조 및 초기화 순서 문제 방지
        const { getUnifiedDatabase } = await import('../../data/models/unified-database');
        const { SkillRepository } = await import('../../data/repositories/skill-repository');
        const repo = new SkillRepository(getUnifiedDatabase().getPool());

        let seededCount = 0;
        let errorCount = 0;

        // general 에이전트 스킬 등록
        try {
            const generalSkillId = 'system-skill-general';

            await repo.upsertSystemSkill(generalSkillId, {
                name: GENERAL_SYSTEM_SKILL_NAME,
                description: '다양한 분야 질문에 대응하는 범용 AI 어시스턴트',
                content: GENERAL_AGENT_SKILL_CONTENT,
                category: 'general',
                isPublic: true,
                sourcePath: 'agents/prompts/general-agent.md',
            });

            await repo.assignSkillToAgent('general', generalSkillId, 0);
            seededCount++;
        } catch (err) {
            logger.error('general 에이전트 스킬 시딩 실패', err);
            errorCount++;
        }

        // system-skill-author-guide 시드 (LLM 에게 create_skill 도구 사용 안내)
        try {
            await seedSystemSkillAuthorGuide(repo);
        } catch (err) {
            logger.error('skill-author-guide 시딩 실패', err);
            errorCount++;
        }

        logger.info(`Base 스킬 시딩 완료: ${seededCount}개 성공, ${errorCount}개 실패`);
    } catch (err) {
        logger.error('Base 스킬 시딩 초기화 실패:', err);
        // 시딩 실패는 서버 시작을 막지 않음
    }
}

/**
 * Skill Author Guide system-skill 시드 (멱등 upsert).
 * LLM 에게 create_skill 도구 사용을 안내. 모든 사용자 세션에 자동 활성
 * (isPublic=true, createdBy=null).
 *
 * 부팅 시 seedBaseSkills() 의 끝부분에서 호출.
 *
 * @param repo - SkillRepository 인스턴스 (호출자가 이미 생성한 것 재사용)
 */
async function seedSystemSkillAuthorGuide(repo: SkillRepository): Promise<void> {
    await repo.upsertSystemSkill('system-skill-author-guide', {
        name: 'Skill Author Guide',
        description: 'LLM 에게 자동 스킬 생성 도구 사용을 안내',
        content: SKILL_AUTHOR_GUIDE_CONTENT,
        category: 'system',
        isPublic: true,
        sourcePath: 'agents/prompts/skill-author-system-prompt.ts',
    });
    logger.info('[SkillSeeder] system-skill-author-guide upserted');
}
