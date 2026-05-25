/**
 * ============================================================
 * ExecutionPlanBuilder — Phase B Routing Unification
 * ============================================================
 *
 * 라우팅 4 layer 를 단일 진입점으로 통합하는 builder. Phase 1 은 위임 단계 —
 * 기존 `buildExecutionPlan` (Layer 2) 과 `selectOptimalModel` (Layer 1+3) 을
 * 그대로 내부 호출합니다. 외부 동작은 변화 없음.
 *
 * Phase 2 에서 LLM classifier 제거, Layer 2·4 흡수 후 단일 결정자가 됩니다.
 *
 * @module chat/execution-plan-builder
 * @see chat/execution-plan-types
 * @see docs/superpowers/plans/2026-05-25-routing-unification-phase-b.md
 */

import { buildExecutionPlan } from './profile-resolver';
import { selectOptimalModel } from './model-selector';
import { normalizeStyle } from './style';
import { createLogger } from '../utils/logger';
import type {
    BuildPlanInput,
    UnifiedExecutionPlan,
    ResolvedUserAgent,
} from './execution-plan-types';

const logger = createLogger('ExecutionPlanBuilder');

export class ExecutionPlanBuilder {
    /**
     * 통합 실행 계획을 구성합니다.
     *
     * Phase 1: 기존 두 함수 결과를 단순 머지.
     * Phase 2-A: classifier round-trip 제거 (regex only).
     * Phase 2-B: capacityDecision 계산 흡수.
     */
    async build(input: BuildPlanInput): Promise<UnifiedExecutionPlan> {
        const { message, hasImages, executionPlan, style: rawStyle, userAgentId, userId } = input;

        const profilePlan = executionPlan ?? buildExecutionPlan('');
        const modelSelection = await selectOptimalModel(message, hasImages);
        const style = normalizeStyle(rawStyle);

        // Phase 2 Custom Agent (2026-05-26): userAgentId 명시 시 소유권 검증 후 prepend.
        // 조회 실패 시 silent fallback — chat 흐름 차단 금지.
        const userAgent = await this.loadUserAgent(userAgentId, userId);

        logger.debug(
            `build: queryType=${modelSelection.queryType} ` +
            `model=${modelSelection.model} ` +
            `strategy=${profilePlan.executionStrategy} ` +
            `style=${style} ` +
            `userAgent=${userAgent?.name ?? 'none'} ` +
            `requestedModel=${profilePlan.requestedModel}`,
        );

        return {
            ...profilePlan,
            modelSelection,
            capacityDecision: null,
            style,
            userAgent,
        };
    }

    private async loadUserAgent(
        userAgentId: string | undefined,
        userId: string | undefined,
    ): Promise<ResolvedUserAgent | null> {
        if (!userAgentId || !userId || userId === 'guest') return null;
        try {
            const { UserAgentRepository } = await import('../data/repositories/user-agent-repository');
            const { getPool } = await import('../data/models/unified-database');
            const repo = new UserAgentRepository(getPool());
            const agent = await repo.getByIdForUser(userAgentId, userId);
            if (!agent || !agent.is_active) return null;
            // usage_count 증가는 fire-and-forget — chat 흐름 차단 금지
            void repo.incrementUsage(agent.id).catch(e =>
                logger.warn('user_agent usage_count 증가 실패 (무시):', e),
            );
            return {
                id: agent.id,
                name: agent.name,
                systemPrompt: agent.system_prompt,
                allowedTools: Array.isArray(agent.allowed_tools) ? agent.allowed_tools : [],
                allowedSkills: Array.isArray(agent.allowed_skills) ? agent.allowed_skills : [],
                icon: agent.icon,
            };
        } catch (e) {
            logger.warn('user_agent 조회 실패 (silent fallback):', e);
            return null;
        }
    }
}

/** Singleton — ChatService 가 주입받지 않는 경로 (request-handler 등) 대비 */
let defaultBuilder: ExecutionPlanBuilder | null = null;

export function getExecutionPlanBuilder(): ExecutionPlanBuilder {
    if (!defaultBuilder) {
        defaultBuilder = new ExecutionPlanBuilder();
    }
    return defaultBuilder;
}
