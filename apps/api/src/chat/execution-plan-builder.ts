/**
 * ============================================================
 * ExecutionPlanBuilder — Phase B Routing Unification
 * ============================================================
 *
 * 라우팅을 단일 진입점으로 모으는 builder — 기존 `buildExecutionPlan` 과
 * `selectOptimalModel` (regex 분류, Phase 2-A 에서 LLM classifier 제거됨) 을
 * 내부 호출해 UnifiedExecutionPlan 으로 머지하는 위임자입니다.
 *
 * ⚠️ strategy 계층 폐기 1단계 (2026-07-18): 유일한 build() 호출처였던
 * message-pipeline 의 strategy dispatch 가 제거되어 full build() 는 현재
 * 호출처 0 (2단계 정리 대상). 채팅 파이프라인은 loadUserAgent() 단독 +
 * regex 분류(classifyQuery — 라우팅 로그 기록용)만 사용합니다.
 *
 * @module chat/execution-plan-builder
 * @see chat/execution-plan-types
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
     * (capacity 결정은 LLMClient.chat per-call 에서 처리 — plan 에 포함하지 않음.)
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
            style,
            userAgent,
        };
    }

    /**
     * Custom Agent 단독 로딩 — 외부 provider 분기 등 full build() 가 필요 없는
     * 경로 (modelSelection 미사용) 에서 user agent
     * 정보만 빠르게 얻기 위한 public helper.
     */
    async loadUserAgent(
        userAgentId: string | undefined,
        userId: string | undefined,
        opts?: {
            /** false = usage_count 미증가 — 모델 배정 조회 등 보조 로드용 (기본 true) */
            countUsage?: boolean;
        },
    ): Promise<ResolvedUserAgent | null> {
        if (!userAgentId || !userId || userId === 'guest') return null;
        try {
            const { UserAgentRepository } = await import('../data/repositories/user-agent-repository');
            const { getPool } = await import('../data/models/unified-database');
            const repo = new UserAgentRepository(getPool());
            const agent = await repo.getByIdForUser(userAgentId, userId);
            if (!agent || !agent.is_active) return null;
            // usage_count 증가는 fire-and-forget — chat 흐름 차단 금지
            if (opts?.countUsage !== false) {
                void repo.incrementUsage(agent.id).catch(e =>
                    logger.warn('user_agent usage_count 증가 실패 (무시):', e),
                );
            }
            return {
                id: agent.id,
                name: agent.name,
                systemPrompt: agent.system_prompt,
                allowedTools: Array.isArray(agent.allowed_tools) ? agent.allowed_tools : [],
                allowedSkills: Array.isArray(agent.allowed_skills) ? agent.allowed_skills : [],
                icon: agent.icon,
                model: agent.model ?? null,
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
