/**
 * ============================================================
 * load_skill 카탈로그 주입 — 채팅·에이전트 작업 공용 (SSoT)
 * ============================================================
 *
 * `load_skill` 은 "스킬을 불러오는 도구" 일 뿐, **어떤 스킬이 있는지는 도구
 * description 에 카탈로그를 실어줘야** 모델이 고를 수 있다(progressive disclosure).
 * 카탈로그 없이 도구만 노출하면 모델은 이름을 몰라 호출하지 못한다.
 *
 * 원래 ChatService 안의 private 메서드였는데, 에이전트 작업 경로에는 없어서
 * load_skill 이 노출돼도 실제 호출이 0건이었다(2026-07-26 실측). 두 경로가 같은
 * 규칙을 쓰도록 여기로 추출한다.
 *
 * @module services/skill-catalog-tool
 */
import type { ToolDefinition } from '../llm/types';
import { getSkillManager } from '../agents/skill-manager';
import { LOAD_SKILL_TOOL_NAME } from '../mcp/load-skill-tool';
import { createLogger } from '../utils/logger';

const logger = createLogger('SkillCatalogTool');

export interface SkillCatalogOptions {
    /**
     * 이미 시스템 프롬프트로 전문 주입된 스킬 id — 카탈로그에서 제외(중복 노출 방지).
     * 채팅은 활성 바인딩, 에이전트 작업은 매니페스트 주입분이 해당.
     */
    excludeIds?: ReadonlySet<string>;
}

/**
 * 도구 목록의 `load_skill` 을 스킬 카탈로그가 실린 정의로 교체한다.
 *
 * - `SKILL_AUTO_SELECT_ENABLED !== 'true'` (기본): load_skill 을 목록에서 제거 (기능 OFF)
 * - 카탈로그가 비었거나 조회 실패: 제거 (graceful — 흐름 무영향)
 * - 정상: description 에 "## Skill Library (N)" 카탈로그를 덧붙인 정의로 교체
 *
 * @param tools    노출 후보 도구 목록
 * @param allTools 전체 도구 카탈로그 — load_skill 기본 정의(파라미터 스키마) 확보용
 */
export async function applySkillCatalog(
    tools: ToolDefinition[],
    allTools: ToolDefinition[],
    opts: SkillCatalogOptions = {},
): Promise<ToolDefinition[]> {
    const without = tools.filter((t) => t.function.name !== LOAD_SKILL_TOOL_NAME);
    if (process.env.SKILL_AUTO_SELECT_ENABLED !== 'true') return without;

    const base = allTools.find((t) => t.function.name === LOAD_SKILL_TOOL_NAME);
    if (!base) return without; // load_skill 미등록 — 노출 안 함

    try {
        const { catalog, count } = await getSkillManager().buildSkillCatalog(
            opts.excludeIds ? { excludeIds: opts.excludeIds } : {},
        );
        if (count === 0) return without;

        const augmented: ToolDefinition = {
            type: 'function',
            function: {
                name: LOAD_SKILL_TOOL_NAME,
                description: `${base.function.description}\n\n## Skill Library (${count})\n${catalog}`,
                parameters: base.function.parameters,
            },
        };
        return [...without, augmented];
    } catch (e) {
        logger.warn('스킬 카탈로그 주입 실패 (load_skill 제외):', e);
        return without;
    }
}
