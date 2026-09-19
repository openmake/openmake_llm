/**
 * Skill Runtime 구현 — Base 포트(`runtime-ports/skill-runtime`)에 꽂히는 어댑터 (2026-09-19).
 *
 * 판단 로직은 이 add-on 의 `SkillManager`·`manifest-injection-*`·`skill-catalog*` 가 그대로 갖고 있고,
 * 여기서는 Base 가 부르는 모양으로만 노출한다. Base 는 이 파일도 `SkillManager` 도 import 하지 않는다.
 *
 * @module addons/skill-runtime/runtime
 */
import type {
    ActiveSkillBinding, ManifestPromptResult, SkillCatalogOptions, SkillRuntime, SkillSummary, SkillUsageEvent,
} from '../../runtime-ports/skill-runtime';
import type { AgentSkill } from '../../data/repositories/skill-repository';
import type { ToolDefinition } from '../../llm/types';
import { getSkillManager } from './skill-manager';
import { isSkillOfferEnabled } from './skill-catalog';
import { applySkillCatalog } from './skill-catalog-tool';
import { recordSkillUsage } from './skill-usage-log';

export const skillRuntime: SkillRuntime = {
    buildManifestPrompt(
        agentId: string, userId?: string, agentCategory?: string, query?: string,
        options: { offerOnOverflow?: boolean } = {},
    ): Promise<ManifestPromptResult | null> {
        return getSkillManager().buildManifestPrompt(agentId, userId, agentCategory, query, options);
    },

    getSkillsForAgent(agentId: string, userId?: string, agentCategory?: string): Promise<AgentSkill[]> {
        return getSkillManager().getSkillsForAgent(agentId, userId, agentCategory);
    },

    buildSkillPrompt(agentId: string, userId?: string, agentCategory?: string): Promise<string> {
        return getSkillManager().buildSkillPrompt(agentId, userId, agentCategory);
    },

    getActiveSkillBindings(agentId: string, userId?: string): Promise<ActiveSkillBinding[]> {
        return getSkillManager().getActiveSkillBindings(agentId, userId);
    },

    applyCatalogToTools(tools: ToolDefinition[], allTools: ToolDefinition[], opts: SkillCatalogOptions = {}): Promise<ToolDefinition[]> {
        return applySkillCatalog(tools, allTools, opts);
    },

    buildSkillPromptForIds(skillIds: string[], userId?: string): Promise<string> {
        return getSkillManager().buildSkillPromptForIds(skillIds, userId);
    },

    /**
     * 슬래시 명령 해석용 검색 — 매칭 규칙(slug ↔ 이름)은 Base 가 갖고, 여기서는 후보만 준다.
     * content 가 null 인 행은 주입할 것이 없으므로 뺀다.
     */
    async searchActiveSkills(opts: { search: string; limit: number; userId?: string }): Promise<SkillSummary[]> {
        const result = await getSkillManager().searchSkills({
            search: opts.search, status: 'active', limit: opts.limit,
            ...(opts.userId ? { userId: opts.userId } : {}),
        });
        return result.skills.map(s => ({ id: s.id, name: s.name, content: s.content ?? '' }));
    },

    recordUsage(events: SkillUsageEvent[]): void {
        recordSkillUsage(events);
    },

    isOfferEnabled(): boolean {
        return isSkillOfferEnabled();
    },
};
