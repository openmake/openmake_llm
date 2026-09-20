/**
 * Skill Runtime add-on 부팅 진입점 — 매니페스트 `entry.runtime` 이 가리킨다 (2026-09-19).
 *
 * 하는 일은 세 가지뿐이다: ① Base 포트에 런타임 구현 등록 ② 스킬 도구(`load_skill`·`create_skill`)를
 * 내장 도구로 기여 ③ Base 스킬(general·author-guide) 시드. 이 add-on 이 꺼지면 셋 다 일어나지 않고
 * Base 는 NULL 구현으로 돈다 — 스킬 주입 0건, `load_skill` 미노출, 스킬 API 404.
 *
 * @module addons/skill-runtime
 */
import { registerSkillRuntime } from '../../runtime-ports/skill-runtime';
import { contributeBuiltInTools } from '../../runtime-ports/builtin-tool-contributions';
import type { MCPToolDefinition } from '../../tool-contract/types';
import { createLogger } from '../../utils/logger';
import { skillRuntime } from './runtime';
import { loadSkillTool } from './load-skill-tool';
import { createSkillTool } from './skill-creator-tool';
import { seedBaseSkills } from './skill-seeder';

const logger = createLogger('SkillRuntimeAddon');

export async function startSkillRuntime(): Promise<void> {
    registerSkillRuntime(skillRuntime);
    contributeBuiltInTools('skill-runtime', [
        loadSkillTool as MCPToolDefinition,
        createSkillTool as MCPToolDefinition,
    ]);
    // 시드는 부팅을 막지 않는다 — 실패는 로그만(fail-open).
    seedBaseSkills().catch((err: unknown) => logger.error('Base 스킬 시딩 실패:', err));
    logger.info('Skill Runtime 등록 완료');
}
