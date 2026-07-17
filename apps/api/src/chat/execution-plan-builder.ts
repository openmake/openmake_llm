/**
 * ============================================================
 * ExecutionPlanBuilder — Custom Agent 로더
 * ============================================================
 *
 * 채팅 파이프라인이 사용하는 Custom Agent(user_agents) 해석기.
 *
 * 구 역할(라우팅 통합 build() — buildExecutionPlan + selectOptimalModel 머지)은
 * 2026-07-18 strategy 계층 폐기 2단계로 삭제됨: 채팅은 streamFromExternalProvider
 * 단일 경로이고 질의 분류는 message-pipeline 이 regex `classifyQuery` 로
 * routingLog 관측에만 기록한다. 남은 책임은 loadUserAgent() 하나 —
 * 클래스/싱글톤 형태는 호출처(message-pipeline, agent-model-override) 호환 유지.
 *
 * @module chat/execution-plan-builder
 */

import { createLogger } from '../utils/logger';

const logger = createLogger('ExecutionPlanBuilder');

/**
 * Custom Agent (user_agents) 해석 결과 — system prompt prepend +
 * tool/skill 화이트리스트 반영용. (구 execution-plan-types.ts 에서 이동.)
 */
export interface ResolvedUserAgent {
    id: string;
    name: string;
    systemPrompt: string;
    allowedTools: string[];
    allowedSkills: string[];
    icon: string | null;
    /** 에이전트 전용 모델 fullId (null=상속) — 요청 model 이 자동일 때만 적용 (Phase C) */
    model: string | null;
}

export class ExecutionPlanBuilder {
    /**
     * Custom Agent 단독 로딩 — userAgentId 명시 시 소유권 검증 후 반환.
     * 조회 실패 시 silent fallback (null) — chat 흐름 차단 금지.
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
