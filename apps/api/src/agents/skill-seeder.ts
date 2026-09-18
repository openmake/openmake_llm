/**
 * Base 스킬 시더 — 팩과 무관하게 항상 있어야 하는 시스템 스킬 (general 에이전트 · skill-author-guide).
 *
 * 산업·유틸리티 스킬은 여기서 만들지 않는다 — 내장 팩의 `skills.json` 을 addon-host 가 설치한다
 * (addon-host/pack-skills.ts, 2026-09-19 이전). 멱등 upsert, 실패는 서버 시작을 막지 않는다.
 *
 * @module agents/skill-seeder
 */

import { createLogger } from '../utils/logger';
import type { SkillRepository } from '../data/repositories/skill-repository';
import { GENERAL_SYSTEM_SKILL_NAME } from './system-skill-names';

const logger = createLogger('SkillSeeder');

/**
 * general 에이전트 스킬과 skill-author-guide 를 DB 에 upsert 하고 general 에 배정한다.
 */
export async function seedBaseSkills(): Promise<void> {
    logger.info('Base 스킬 시딩 시작...');

    try {
        // 지연 로딩: 순환 참조 및 초기화 순서 문제 방지
        const { getUnifiedDatabase } = await import('../data/models/unified-database');
        const { SkillRepository } = await import('../data/repositories/skill-repository');
        const repo = new SkillRepository(getUnifiedDatabase().getPool());

        let seededCount = 0;
        let errorCount = 0;

        // general 에이전트 스킬 등록
        try {
            const generalSkillId = 'system-skill-general';
            const generalContent = `# 🤖 범용 AI 어시스턴트 전문 스킬 지침

## 전문가 정의
**범용 AI 어시스턴트**는 다양한 분야의 질문에 유연하게 대응하는 지능형 어시스턴트입니다.

## 핵심 역량

### 다학제적 지식
- 기술, 금융, 의료, 법률, 비즈니스 등 다양한 분야의 기본 지식
- 전문 분야 간 연결점 발견과 통합적 관점 제공
- 최신 정보와 트렌드 반영

### 소통 능력
- 복잡한 개념을 쉽게 설명하는 능력
- 질문의 핵심 의도를 파악하는 능력
- 다양한 배경의 사용자에게 맞춤형 답변 제공

## 응답 원칙

1. **정확성**: 사실에 기반한 정확한 정보 제공
2. **유용성**: 실제로 도움이 되는 실용적 답변
3. **명확성**: 이해하기 쉬운 언어와 구조
4. **한계 인식**: 불확실한 정보는 솔직하게 표현
5. **전문가 연계**: 전문적 조언이 필요한 경우 해당 전문가 상담 권고

## 응답 형식
- 모든 답변은 사용자 선호 언어로 제공
- 구조화된 형식으로 명확하게 전달
- 필요시 구체적 예시와 참고 자료 포함`;

            await repo.upsertSystemSkill(generalSkillId, {
                name: GENERAL_SYSTEM_SKILL_NAME,
                description: '다양한 분야 질문에 대응하는 범용 AI 어시스턴트',
                content: generalContent,
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
    const content = `# 스킬 생성 도구 사용 안내

사용자가 다음 의도를 보이면 \`create_skill\` 도구를 호출하라:
- "X 분야 (전문) 스킬 만들어줘"
- "X 에 대한 에이전트 스킬 등록해줘"
- "이런 작업 자주 하니까 skill 로 만들어"

호출 시 \`purpose\` (사용자가 원하는 분야/기능) 를 명확히 전달.
\`target='system'\` 은 admin 만 가능 (그 외는 자동 'user' 로 강등됨).

도구 응답은 draft 상태이며, 사용자가 검토 카드에서 [저장] 클릭해야 활성화됨.`;

    await repo.upsertSystemSkill('system-skill-author-guide', {
        name: 'Skill Author Guide',
        description: 'LLM 에게 자동 스킬 생성 도구 사용을 안내',
        content,
        category: 'system',
        isPublic: true,
        sourcePath: 'agents/prompts/skill-author-system-prompt.ts',
    });
    logger.info('[SkillSeeder] system-skill-author-guide upserted');
}
